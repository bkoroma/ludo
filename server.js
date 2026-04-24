// ============================================================================
// Ludo Club v5 — server
// ============================================================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const engine = require("./server/engine");
const catalog = require("./server/catalog");
const store = require("./server/profiles");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 30000
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "32kb" }));

// ---- Rate limiter (in-memory, per playerKey + action) ---------------------
// Modeled on the 3-layer limiter you shipped in AfriBConnect — lightweight
// version here since this is a game server, not a full social stack.
const limits = new Map(); // key -> [timestamps]
function rateLimit(playerKey, action, maxPerWindow, windowMs) {
  const now = Date.now();
  const k = `${playerKey}:${action}`;
  const arr = (limits.get(k) || []).filter(t => now - t < windowMs);
  if (arr.length >= maxPerWindow) return false;
  arr.push(now);
  limits.set(k, arr);
  return true;
}
// Periodically GC the limit map to avoid unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of limits) {
    const fresh = arr.filter(t => now - t < 60_000);
    if (fresh.length === 0) limits.delete(k);
    else limits.set(k, fresh);
  }
}, 60_000).unref();

// ---- HTTP API -------------------------------------------------------------
app.get("/api/catalog", (req, res) => {
  res.json({
    tables: catalog.TABLES,
    tableSkins: catalog.TABLE_SKINS,
    tokenSkins: catalog.TOKEN_SKINS,
    diceSkins: catalog.DICE_SKINS,
    powerUps: catalog.POWER_UPS,
    coinPacks: catalog.COIN_PACKS,
    emojis: catalog.EMOJIS,
    quickChat: catalog.QUICK_CHAT
  });
});

function assertValidKey(req, res) {
  const k = String(req.params.playerKey || "");
  if (!k || k.length > 64 || !/^[a-zA-Z0-9_\-]+$/.test(k)) {
    res.status(400).json({ error: "Invalid playerKey" });
    return null;
  }
  return k;
}

app.get("/api/profile/:playerKey", (req, res) => {
  const k = assertValidKey(req, res); if (!k) return;
  const p = store.getOrCreate(k);
  store.rollWeekIfNeeded(p);
  res.json(p);
});

app.post("/api/profile/:playerKey/name", (req, res) => {
  const k = assertValidKey(req, res); if (!k) return;
  const name = store.sanitizeName(req.body?.displayName);
  store.getOrCreate(k, name);
  res.json(store.update(k, { displayName: name }));
});

app.post("/api/profile/:playerKey/claim-daily", (req, res) => {
  const k = assertValidKey(req, res); if (!k) return;
  const p = store.getOrCreate(k);
  const today = store.todayKey();
  if (p.dailyClaim === today) return res.status(400).json({ error: "Already claimed today", profile: p });
  let streak = 1;
  if (p.dailyClaim === store.yesterdayKey()) streak = (p.streak || 0) + 1;
  const reward = catalog.dailyRewardFor(streak);
  const updated = store.update(k, {
    dailyClaim: today,
    streak,
    coins: p.coins + reward,
    coinsEarnedTotal: (p.coinsEarnedTotal || 0) + reward
  });
  res.json({ reward, streak, profile: updated });
});

app.post("/api/profile/:playerKey/buy", (req, res) => {
  const k = assertValidKey(req, res); if (!k) return;
  const { category, itemId } = req.body || {};
  const p = store.getOrCreate(k);
  const map = {
    tableSkin: { list: catalog.TABLE_SKINS, owned: "tableSkinsOwned" },
    tokenSkin: { list: catalog.TOKEN_SKINS, owned: "tokenSkinsOwned" },
    diceSkin:  { list: catalog.DICE_SKINS,  owned: "diceSkinsOwned" }
  };
  const entry = map[category];
  if (!entry) return res.status(400).json({ error: "Unknown category" });
  const item = entry.list.find(x => x.id === itemId);
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (p[entry.owned].includes(item.id)) return res.status(400).json({ error: "Already owned", profile: p });
  if (p.coins < item.price) return res.status(400).json({ error: "Not enough coins", profile: p });
  const updated = store.update(k, {
    coins: p.coins - item.price,
    [entry.owned]: [...p[entry.owned], item.id]
  });
  res.json(updated);
});

app.post("/api/profile/:playerKey/select", (req, res) => {
  const k = assertValidKey(req, res); if (!k) return;
  const { category, itemId } = req.body || {};
  const p = store.getOrCreate(k);
  const map = {
    tableSkin: { owned: "tableSkinsOwned", selected: "selectedTableSkin" },
    tokenSkin: { owned: "tokenSkinsOwned", selected: "selectedTokenSkin" },
    diceSkin:  { owned: "diceSkinsOwned",  selected: "selectedDiceSkin" }
  };
  const entry = map[category];
  if (!entry) return res.status(400).json({ error: "Unknown category" });
  if (!p[entry.owned].includes(itemId)) return res.status(400).json({ error: "Not owned" });
  res.json(store.update(k, { [entry.selected]: itemId }));
});

app.post("/api/profile/:playerKey/buy-powerup", (req, res) => {
  const k = assertValidKey(req, res); if (!k) return;
  const { itemId, qty } = req.body || {};
  const count = Math.max(1, Math.min(20, Math.floor(Number(qty) || 1)));
  const item = catalog.POWER_UPS.find(x => x.id === itemId);
  if (!item) return res.status(404).json({ error: "Not found" });
  const p = store.getOrCreate(k);
  const cost = item.price * count;
  if (p.coins < cost) return res.status(400).json({ error: "Not enough coins" });
  const nextPU = { ...p.powerUps };
  nextPU[item.id] = (nextPU[item.id] || 0) + count;
  res.json(store.update(k, { coins: p.coins - cost, powerUps: nextPU }));
});

app.post("/api/profile/:playerKey/buy-coins", (req, res) => {
  const k = assertValidKey(req, res); if (!k) return;
  // NOTE: no real payment here — this simulates a successful purchase.
  // In AfriBConnect, swap this for a server-side call that verifies a
  // Paystack/Flutterwave webhook BEFORE crediting coins.
  const pack = catalog.COIN_PACKS.find(x => x.id === req.body?.packId);
  if (!pack) return res.status(404).json({ error: "Pack not found" });
  const p = store.getOrCreate(k);
  res.json(store.update(k, { coins: p.coins + pack.coins }));
});

app.get("/api/leaderboard/global",  (_, res) => res.json(store.globalLeaderboard(20)));
app.get("/api/leaderboard/weekly",  (_, res) => res.json(store.weeklyLeaderboard(20)));

app.get("/api/clubs", (_, res) => res.json(store.listClubs()));
app.get("/api/clubs/:id", (req, res) => {
  const c = store.getClub(req.params.id);
  if (!c) return res.status(404).json({ error: "Not found" });
  res.json(c);
});
app.post("/api/clubs", (req, res) => {
  const { ownerKey, name, description } = req.body || {};
  if (!ownerKey) return res.status(400).json({ error: "ownerKey required" });
  store.getOrCreate(ownerKey);
  const r = store.createClub({ ownerKey, name, description });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
app.post("/api/clubs/:id/join", (req, res) => {
  const { playerKey } = req.body || {};
  if (!playerKey) return res.status(400).json({ error: "playerKey required" });
  store.getOrCreate(playerKey);
  const r = store.joinClub({ playerKey, clubId: req.params.id });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
app.post("/api/clubs/leave", (req, res) => {
  const { playerKey } = req.body || {};
  if (!playerKey) return res.status(400).json({ error: "playerKey required" });
  const r = store.leaveClub({ playerKey });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
app.post("/api/clubs/chat", (req, res) => {
  const { playerKey, text } = req.body || {};
  const r = store.postClubChat({ playerKey, text });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});
app.post("/api/clubs/gift", (req, res) => {
  const { fromKey, toKey, amount } = req.body || {};
  if (!rateLimit(fromKey || "_", "gift", 10, 60_000)) return res.status(429).json({ error: "Too many gifts" });
  const r = store.giftCoins({ fromKey, toKey, amount });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ============================================================================
// Socket.IO game rooms
// ============================================================================
const rooms = new Map();          // code -> room
const queueByTable = new Map();   // tableId -> [{playerKey, socketId, name}]
const TURN_SECONDS = 20;
const BOT_THINK_MS = 900;         // how long bots "think" between actions
const MAX_CHAT = 30;

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function createRoom({ tableId, kind = "private" }) {
  let code = randCode();
  while (rooms.has(code)) code = randCode();
  const table = catalog.TABLES.find(t => t.id === tableId) || catalog.TABLES[0];
  const room = {
    code,
    tableId: table.id,
    tableName: table.name,
    buyIn: table.buyIn,
    kind,                         // "private" | "matchmaking" | "bot"
    maxPlayers: table.kind === "2p" ? 2 : 4,
    isBotTable: !!table.bot,
    players: [],                  // array of player objects
    started: false,
    game: null,                   // engine state
    chat: [],
    turnEndsAt: null,
    turnTimer: null,
    botTimer: null,
    winner: null,
    shieldsActive: {},            // color -> bool (consumed on next capture attempt)
    pendingPowerup: null,         // { color, id } — applied to next roll
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function disposeRoom(room) {
  clearRoomTimers(room);
  rooms.delete(room.code);
}
function clearRoomTimers(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  if (room.botTimer)  clearTimeout(room.botTimer);
  room.turnTimer = null;
  room.botTimer = null;
}

function chatSystem(room, text) {
  room.chat.push({ system: true, text, at: Date.now() });
  if (room.chat.length > MAX_CHAT) room.chat.shift();
}

// Strip non-broadcast fields before shipping room state to clients.
function serializeRoom(room) {
  return {
    code: room.code,
    tableId: room.tableId,
    tableName: room.tableName,
    buyIn: room.buyIn,
    kind: room.kind,
    maxPlayers: room.maxPlayers,
    isBotTable: room.isBotTable,
    started: room.started,
    winner: room.winner,
    chat: room.chat,
    turnEndsAt: room.turnEndsAt,
    turnSeconds: TURN_SECONDS,
    players: room.players.map(p => {
      const profile = store.profiles[p.playerKey];
      return {
        playerKey: p.playerKey,
        name: p.name,
        color: p.color,
        isBot: !!p.isBot,
        connected: p.isBot ? true : !!p.socketId,
        // Selected cosmetics flow to all clients so everyone sees your skin.
        cosmetics: profile ? {
          tokenSkin: profile.selectedTokenSkin,
          diceSkin: profile.selectedDiceSkin,
          tableSkin: profile.selectedTableSkin
        } : null,
        coins: profile ? profile.coins : 0,
        xp: profile ? profile.xp : 0,
        powerUps: profile ? profile.powerUps : {}
      };
    }),
    game: room.game ? {
      currentTurn: room.game.currentTurn,
      currentColor: room.game.colors[room.game.currentTurn],
      lastRoll: room.game.lastRoll,
      mustMove: room.game.mustMove,
      movableTokenIds: room.game.movableTokenIds,
      sixesThisTurn: room.game.sixesThisTurn,
      pieces: room.game.pieces
    } : null,
    shieldsActive: room.shieldsActive,
    pendingPowerup: room.pendingPowerup
  };
}

function broadcast(room) {
  io.to(room.code).emit("state", serializeRoom(room));
}

function scheduleTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.turnTimer = null;
  if (!room.started || room.winner || !room.game) return;
  room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  room.turnTimer = setTimeout(() => handleTurnTimeout(room), TURN_SECONDS * 1000);
}

function handleTurnTimeout(room) {
  if (!room.started || room.winner || !room.game) return;
  const g = room.game;
  const current = room.game.colors[g.currentTurn];
  if (g.mustMove && g.movableTokenIds.length) {
    // Auto-move first legal token on timeout so the game keeps flowing.
    applyMoveAndTick(room, current, g.movableTokenIds[0], /*auto*/ true);
  } else if (g.mustMove) {
    // No legal moves somehow; just advance.
    g.mustMove = false; g.movableTokenIds = []; g.lastRoll = null;
    g.currentTurn = (g.currentTurn + 1) % g.colors.length;
    chatSystem(room, "Turn timed out.");
    scheduleTurnTimer(room);
    broadcast(room);
    scheduleBotIfNeeded(room);
  } else {
    // Player didn't even roll. Auto-roll then act.
    autoRollAndAct(room);
  }
}

function autoRollAndAct(room) {
  const g = room.game;
  if (!g || room.winner) return;
  const current = g.colors[g.currentTurn];
  const rng = getRngForRoom(room);
  const rolled = engine.rollDice(g, rng);
  chatSystem(room, `${current.toUpperCase()} auto-rolled ${rolled.roll ?? "-"}.`);
  if (g.mustMove && g.movableTokenIds.length) {
    applyMoveAndTick(room, current, g.movableTokenIds[0], true);
  } else {
    scheduleTurnTimer(room);
    broadcast(room);
    scheduleBotIfNeeded(room);
  }
}

// RNG for this room. Uses Math.random by default; if a power-up pending
// matches this color & turn, it overrides deterministically.
function getRngForRoom(room) {
  return () => {
    if (room.pendingPowerup) {
      const pu = room.pendingPowerup;
      const current = room.game.colors[room.game.currentTurn];
      if (pu.color === current) {
        if (pu.id === "lucky_six") {
          room.pendingPowerup = null;
          chatSystem(room, `${current.toUpperCase()} used Lucky Six.`);
          return 6;
        }
      }
    }
    return 1 + Math.floor(Math.random() * 6);
  };
}

// Shield: absorb one incoming capture per token owner
function withShieldGuard(room, applyFn) {
  // Snapshot pieces-by-color before the move
  const before = {};
  for (const color of room.game.colors) {
    before[color] = room.game.pieces[color].map(p => ({ id: p.id, progress: p.progress }));
  }
  const result = applyFn();
  // If any opponent piece had progress >= 0 before and is now at BASE, and
  // that opponent has a shield active, UNDO the capture for that piece.
  for (const color of room.game.colors) {
    if (!room.shieldsActive[color]) continue;
    const prev = before[color];
    const now = room.game.pieces[color];
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].progress > engine.BASE && now[i].progress === engine.BASE) {
        now[i].progress = prev[i].progress;
        room.shieldsActive[color] = false;
        chatSystem(room, `${color.toUpperCase()}'s shield absorbed a capture.`);
        // Mark only one shielded recovery per event
        if (result && Array.isArray(result.captures)) {
          result.captures = result.captures.filter(c => c.color !== color);
        }
        break;
      }
    }
  }
  return result;
}

function applyMoveAndTick(room, color, tokenId, auto = false) {
  const g = room.game;
  const result = withShieldGuard(room, () => engine.moveToken(g, color, tokenId));
  if (!result.ok) return result;

  // Stats: captures credit
  if (result.captures && result.captures.length) {
    const attacker = room.players.find(p => p.color === color);
    if (attacker && !attacker.isBot && store.profiles[attacker.playerKey]) {
      store.increment(attacker.playerKey, { capturesTotal: result.captures.length });
    }
  }

  if (result.winner) {
    settleGame(room, result.winner);
  } else {
    scheduleTurnTimer(room);
  }
  broadcast(room);
  scheduleBotIfNeeded(room);
  return result;
}

function settleGame(room, winnerColor) {
  clearRoomTimers(room);
  room.winner = winnerColor;
  room.started = false;
  room.turnEndsAt = null;

  const payout = catalog.calculatePayout(room.buyIn, room.players.length);
  chatSystem(room, `${winnerColor.toUpperCase()} wins! Pot: ${payout.pot || 0} coins.`);

  room.players.forEach(pl => {
    if (pl.isBot) return;
    const profile = store.getOrCreate(pl.playerKey, pl.name);
    store.rollWeekIfNeeded(profile);
    const won = pl.color === winnerColor;
    const earned = won ? payout.winner : payout.loser;
    const xpGain = won ? 60 : 15;
    store.update(pl.playerKey, {
      wins: profile.wins + (won ? 1 : 0),
      losses: profile.losses + (won ? 0 : 1),
      gamesPlayed: profile.gamesPlayed + 1,
      coins: profile.coins + earned,
      coinsEarnedTotal: profile.coinsEarnedTotal + earned,
      xp: profile.xp + xpGain,
      weeklyWins: profile.weeklyWins + (won ? 1 : 0),
      weeklyCoinsEarned: profile.weeklyCoinsEarned + earned
    });
  });
}

// ---- Bot driver -----------------------------------------------------------
function scheduleBotIfNeeded(room) {
  clearTimeout(room.botTimer);
  room.botTimer = null;
  if (!room.started || room.winner || !room.game) return;
  const current = room.players[room.game.currentTurn];
  if (!current || !current.isBot) return;
  room.botTimer = setTimeout(() => driveBotTurn(room), BOT_THINK_MS);
}

function driveBotTurn(room) {
  const g = room.game;
  if (!g || !room.started || room.winner) return;
  const current = room.players[g.currentTurn];
  if (!current || !current.isBot) return;

  if (!g.mustMove) {
    const rng = getRngForRoom(room);
    engine.rollDice(g, rng);
    broadcast(room);
    if (g.mustMove) {
      room.botTimer = setTimeout(() => driveBotTurn(room), BOT_THINK_MS);
    } else if (!room.winner) {
      // No legal move → engine already advanced turn.
      scheduleTurnTimer(room);
      scheduleBotIfNeeded(room);
    }
    return;
  }

  // Must move — pick via AI
  const choice = engine.chooseAiMove(g, current.color);
  if (!choice) return;
  applyMoveAndTick(room, current.color, choice, true);
}

// ---- Room mgmt helpers ----------------------------------------------------
function findRoomByPlayerKey(playerKey) {
  for (const r of rooms.values()) if (r.players.find(p => p.playerKey === playerKey)) return r;
  return null;
}
function removePlayerFromQueues(playerKey) {
  for (const arr of queueByTable.values()) {
    const idx = arr.findIndex(e => e.playerKey === playerKey);
    if (idx >= 0) arr.splice(idx, 1);
  }
}
function removePlayerFromRoom(room, playerKey) {
  const idx = room.players.findIndex(p => p.playerKey === playerKey);
  if (idx < 0) return;
  room.players.splice(idx, 1);
  if (room.players.length === 0 || room.players.filter(p => !p.isBot).length === 0) {
    disposeRoom(room);
    return;
  }
  // Reassign colors in order, keep game alive if still enough humans
  if (room.started) {
    // A leaver mid-match forfeits — settle to a remaining player.
    if (room.game && !room.winner && room.players.length === 1) {
      settleGame(room, room.players[0].color);
    } else if (room.game && !room.winner) {
      // Skip their turns going forward — mark as disconnected; engine still
      // runs turns on them but without moves they auto-pass.
      chatSystem(room, "A player left the match.");
    }
  } else {
    room.players.forEach((p, i) => p.color = engine.PLAYER_ORDER[i]);
  }
  room.updatedAt = Date.now();
}

function addBotToRoom(room) {
  const colorIdx = room.players.length;
  const color = engine.PLAYER_ORDER[colorIdx];
  const botNames = ["Kofi-Bot", "Amara-Bot", "Zuri-Bot", "Chike-Bot"];
  room.players.push({
    playerKey: `bot_${room.code}_${colorIdx}`,
    name: botNames[colorIdx % botNames.length],
    color,
    isBot: true,
    socketId: null
  });
}

function deductBuyInsOrReject(room) {
  if (room.buyIn <= 0) return { ok: true };
  for (const pl of room.players) {
    if (pl.isBot) continue;
    const p = store.profiles[pl.playerKey];
    if (!p || p.coins < room.buyIn) {
      return { ok: false, error: `${pl.name} cannot afford the buy-in.` };
    }
  }
  for (const pl of room.players) {
    if (pl.isBot) continue;
    const p = store.profiles[pl.playerKey];
    store.update(pl.playerKey, { coins: p.coins - room.buyIn });
  }
  return { ok: true };
}

function startRoomMatch(room) {
  if (room.players.length < 2 && !room.isBotTable) {
    return { error: "Need at least 2 players" };
  }
  // If it's a bot table with 1 human, fill with bots to 4
  if (room.isBotTable) {
    while (room.players.length < room.maxPlayers) addBotToRoom(room);
  }
  const buy = deductBuyInsOrReject(room);
  if (!buy.ok) return buy;

  const colors = room.players.map(p => p.color);
  room.game = engine.createGameState({ colors });
  room.started = true;
  room.winner = null;
  room.shieldsActive = {};
  room.pendingPowerup = null;
  chatSystem(room, "Match started.");
  scheduleTurnTimer(room);
  scheduleBotIfNeeded(room);
  return { ok: true };
}

// ---- Socket handlers ------------------------------------------------------
io.on("connection", (socket) => {
  socket.on("hello", ({ playerKey, name } = {}) => {
    if (!playerKey) return;
    store.getOrCreate(playerKey, name);
    socket.data.playerKey = playerKey;
    socket.emit("hello_ok");
  });

  socket.on("create_room", ({ playerKey, name, tableId } = {}) => {
    if (!playerKey) return socket.emit("error_message", "Missing playerKey");
    if (!rateLimit(playerKey, "create_room", 10, 60_000)) {
      return socket.emit("error_message", "Too many rooms — slow down.");
    }
    removePlayerFromQueues(playerKey);
    const existing = findRoomByPlayerKey(playerKey);
    if (existing) removePlayerFromRoom(existing, playerKey);

    const profile = store.getOrCreate(playerKey, name);
    const table = catalog.TABLES.find(t => t.id === tableId);
    if (table && table.buyIn > 0 && profile.coins < table.buyIn) {
      return socket.emit("error_message", "Not enough coins for this table.");
    }
    const room = createRoom({ tableId, kind: "private" });
    room.players.push({
      playerKey, name: profile.displayName, color: engine.PLAYER_ORDER[0], isBot: false, socketId: socket.id
    });
    if (room.isBotTable) {
      while (room.players.length < room.maxPlayers) addBotToRoom(room);
    }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerKey = playerKey;
    socket.emit("room_joined", { roomCode: room.code, color: engine.PLAYER_ORDER[0], host: true });
    broadcast(room);
  });

  socket.on("join_room", ({ playerKey, name, roomCode } = {}) => {
    if (!playerKey) return socket.emit("error_message", "Missing playerKey");
    if (!rateLimit(playerKey, "join_room", 20, 60_000)) {
      return socket.emit("error_message", "Too many join attempts.");
    }
    removePlayerFromQueues(playerKey);
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room) return socket.emit("error_message", "Room not found");
    if (room.started) return socket.emit("error_message", "Game already started");
    if (room.players.length >= room.maxPlayers) return socket.emit("error_message", "Room is full");

    const profile = store.getOrCreate(playerKey, name);
    const existing = room.players.find(p => p.playerKey === playerKey);
    if (existing) {
      existing.socketId = socket.id;
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerKey = playerKey;
      socket.emit("room_joined", { roomCode: room.code, color: existing.color, host: room.players[0]?.playerKey === playerKey });
      return broadcast(room);
    }
    // Insert the new player before any trailing bots, so colors stay sensible.
    const humansBefore = room.players.filter(p => !p.isBot).length;
    const color = engine.PLAYER_ORDER[humansBefore];
    room.players = room.players.filter(p => !p.isBot);
    room.players.push({ playerKey, name: profile.displayName, color, isBot: false, socketId: socket.id });
    if (room.isBotTable) {
      while (room.players.length < room.maxPlayers) addBotToRoom(room);
    }
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerKey = playerKey;
    socket.emit("room_joined", { roomCode: room.code, color, host: false });
    broadcast(room);
  });

  socket.on("join_matchmaking", ({ playerKey, name, tableId } = {}) => {
    if (!playerKey) return socket.emit("error_message", "Missing playerKey");
    if (!rateLimit(playerKey, "queue", 30, 60_000)) {
      return socket.emit("error_message", "Slow down.");
    }
    const table = catalog.TABLES.find(t => t.id === tableId);
    if (!table) return socket.emit("error_message", "Unknown table");
    const profile = store.getOrCreate(playerKey, name);
    if (table.buyIn > 0 && profile.coins < table.buyIn) {
      return socket.emit("error_message", "Not enough coins for this table.");
    }
    removePlayerFromQueues(playerKey);
    const existing = findRoomByPlayerKey(playerKey);
    if (existing) removePlayerFromRoom(existing, playerKey);

    const q = queueByTable.get(table.id) || [];
    q.push({ playerKey, name: profile.displayName, socketId: socket.id });
    queueByTable.set(table.id, q);

    const need = table.kind === "2p" ? 2 : 4;
    if (q.length >= need) {
      const entrants = q.splice(0, need);
      queueByTable.set(table.id, q);
      const room = createRoom({ tableId: table.id, kind: "matchmaking" });
      entrants.forEach((e, idx) => {
        const s = io.sockets.sockets.get(e.socketId);
        if (!s) return;
        room.players.push({
          playerKey: e.playerKey, name: e.name,
          color: engine.PLAYER_ORDER[idx], isBot: false, socketId: s.id
        });
        s.join(room.code);
        s.data.roomCode = room.code;
        s.data.playerKey = e.playerKey;
        s.emit("room_joined", { roomCode: room.code, color: engine.PLAYER_ORDER[idx], host: idx === 0, matched: true });
      });
      // Matchmaking auto-starts.
      const sr = startRoomMatch(room);
      if (sr.error) {
        chatSystem(room, sr.error);
        // Return buy-ins and close room
        disposeRoom(room);
      } else {
        broadcast(room);
      }
    } else {
      socket.emit("queue_status", { tableId: table.id, queued: true, size: q.length, need });
    }
  });

  socket.on("cancel_matchmaking", ({ playerKey } = {}) => {
    removePlayerFromQueues(playerKey);
    socket.emit("queue_status", { queued: false, size: 0 });
  });

  socket.on("start_game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.players[0]?.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Only host can start");
    const r = startRoomMatch(room);
    if (r.error) return socket.emit("error_message", r.error);
    broadcast(room);
  });

  socket.on("leave_room", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.data.playerKey) return;
    removePlayerFromRoom(room, socket.data.playerKey);
    socket.leave(room.code);
    if (rooms.has(room.code)) broadcast(room);
  });

  socket.on("roll_dice", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || !room.game || room.winner) return;
    const g = room.game;
    const current = g.colors[g.currentTurn];
    const player = room.players[g.currentTurn];
    if (!player || player.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Not your turn");
    if (!rateLimit(socket.data.playerKey, "roll", 60, 60_000)) return socket.emit("error_message", "Slow down.");
    if (g.mustMove) return socket.emit("error_message", "Move a token first");

    const rng = getRngForRoom(room);
    engine.rollDice(g, rng);
    if (!g.mustMove && !room.winner) {
      // Engine already advanced the turn for no-legal-moves or 3-sixes
      scheduleTurnTimer(room);
      scheduleBotIfNeeded(room);
    } else {
      scheduleTurnTimer(room);
    }
    broadcast(room);
  });

  socket.on("move_token", ({ tokenId } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || !room.game || room.winner) return;
    const g = room.game;
    const current = g.colors[g.currentTurn];
    const player = room.players[g.currentTurn];
    if (!player || player.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Not your turn");
    if (!rateLimit(socket.data.playerKey, "move", 120, 60_000)) return socket.emit("error_message", "Slow down.");
    const r = applyMoveAndTick(room, current, String(tokenId));
    if (!r.ok) socket.emit("error_message", r.error);
  });

  socket.on("use_powerup", ({ powerUpId } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || !room.game || room.winner) return;
    const g = room.game;
    const player = room.players[g.currentTurn];
    if (!player || player.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Not your turn");
    const profile = store.profiles[player.playerKey];
    if (!profile) return;
    const count = profile.powerUps?.[powerUpId] || 0;
    if (count <= 0) return socket.emit("error_message", "You don't own that power-up.");

    // Consume
    const nextPU = { ...profile.powerUps, [powerUpId]: count - 1 };
    store.update(player.playerKey, { powerUps: nextPU });

    if (powerUpId === "lucky_six") {
      if (g.mustMove) return socket.emit("error_message", "Use before rolling.");
      room.pendingPowerup = { color: player.color, id: "lucky_six" };
    } else if (powerUpId === "reroll") {
      if (!g.mustMove) return socket.emit("error_message", "Roll first to reroll.");
      // Discard current roll state and reroll
      g.mustMove = false; g.movableTokenIds = []; g.lastRoll = null;
      // Reroll does NOT consume a 6-streak; decrement if previous was a 6
      if (g.sixesThisTurn > 0) g.sixesThisTurn -= 1;
      const rng = getRngForRoom(room);
      engine.rollDice(g, rng);
      chatSystem(room, `${player.color.toUpperCase()} used Reroll.`);
    } else if (powerUpId === "shield") {
      room.shieldsActive[player.color] = true;
      chatSystem(room, `${player.color.toUpperCase()} raised a Shield.`);
    } else if (powerUpId === "double_dice") {
      // Roll twice, pick the higher — simple interpretation.
      if (g.mustMove) return socket.emit("error_message", "Use before rolling.");
      const r1 = 1 + Math.floor(Math.random() * 6);
      const r2 = 1 + Math.floor(Math.random() * 6);
      const picked = Math.max(r1, r2);
      chatSystem(room, `${player.color.toUpperCase()} used Double Dice: ${r1} & ${r2} → ${picked}.`);
      engine.rollDice(g, () => picked);
    }
    scheduleTurnTimer(room);
    broadcast(room);
  });

  socket.on("send_emoji", ({ emoji } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.data.playerKey) return;
    if (!catalog.EMOJIS.includes(emoji)) return;
    if (!rateLimit(socket.data.playerKey, "emoji", 20, 10_000)) return;
    const player = room.players.find(p => p.playerKey === socket.data.playerKey);
    if (!player) return;
    room.chat.push({ system: false, from: player.name, color: player.color, emoji, at: Date.now() });
    if (room.chat.length > MAX_CHAT) room.chat.shift();
    broadcast(room);
  });

  socket.on("send_quick_chat", ({ text } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.data.playerKey) return;
    if (!catalog.QUICK_CHAT.includes(text)) return;
    if (!rateLimit(socket.data.playerKey, "quick", 20, 10_000)) return;
    const player = room.players.find(p => p.playerKey === socket.data.playerKey);
    if (!player) return;
    room.chat.push({ system: false, from: player.name, color: player.color, text, at: Date.now() });
    if (room.chat.length > MAX_CHAT) room.chat.shift();
    broadcast(room);
  });

  socket.on("reset_game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.players[0]?.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Only host can reset");
    clearRoomTimers(room);
    room.started = false;
    room.winner = null;
    room.game = null;
    room.shieldsActive = {};
    room.pendingPowerup = null;
    chatSystem(room, "Match reset.");
    broadcast(room);
  });

  socket.on("reconnect_session", ({ playerKey } = {}) => {
    if (!playerKey) return;
    const room = findRoomByPlayerKey(playerKey);
    if (!room) return socket.emit("session_info", { inRoom: false });
    const player = room.players.find(p => p.playerKey === playerKey);
    if (!player) return socket.emit("session_info", { inRoom: false });
    player.socketId = socket.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerKey = playerKey;
    socket.emit("session_info", {
      inRoom: true, roomCode: room.code, color: player.color,
      host: room.players[0]?.playerKey === playerKey
    });
    broadcast(room);
  });

  socket.on("disconnect", () => {
    removePlayerFromQueues(socket.data.playerKey);
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.data.playerKey) return;
    const player = room.players.find(p => p.playerKey === socket.data.playerKey);
    if (player) player.socketId = null;
    room.updatedAt = Date.now();
    broadcast(room);
  });
});

// Simple health endpoint
app.get("/api/health", (_, res) => res.json({ ok: true, ts: Date.now(), rooms: rooms.size }));

server.listen(PORT, () => {
  console.log(`Ludo Club v5 listening on http://localhost:${PORT}`);
});
