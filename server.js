const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const DATA_FILE = path.join(__dirname, "data", "profiles.json");
const rooms = new Map();
const matchmakingQueue = [];
const TURN_SECONDS = 20;

const PLAYER_ORDER = ["red", "green", "yellow", "blue"];
const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

const SHOP = {
  tableSkins: [
    { id: "classic", name: "Classic Table", price: 0 },
    { id: "wood", name: "Wood Table", price: 140 },
    { id: "emerald", name: "Emerald Table", price: 180 },
    { id: "royal", name: "Royal Table", price: 260 }
  ],
  ludoSkins: [
    { id: "classic", name: "Classic Tokens", price: 0 },
    { id: "marble", name: "Marble Tokens", price: 120 },
    { id: "neon", name: "Neon Tokens", price: 180 },
    { id: "gold", name: "Gold Tokens", price: 260 }
  ],
  emojis: ["😀","🎲","🔥","😎","👏","😡","💥","👑"]
};

function ensureDataFile() {
  if (!fs.existsSync(path.dirname(DATA_FILE))) fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
}
ensureDataFile();

function readProfiles() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch { return {}; }
}
function writeProfiles(profiles) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(profiles, null, 2));
}
const profiles = readProfiles();

function getOrCreateProfile(playerKey, name = "Player") {
  if (!profiles[playerKey]) {
    profiles[playerKey] = {
      playerKey,
      displayName: String(name || "Player").slice(0, 24),
      coins: 200,
      wins: 0,
      losses: 0,
      gamesPlayed: 0,
      tableSkinsOwned: ["classic"],
      selectedTableSkin: "classic",
      ludoSkinsOwned: ["classic"],
      selectedLudoSkin: "classic",
      dailyClaim: null,
      streak: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    writeProfiles(profiles);
  } else {
    // migration from older profile formats
    const p = profiles[playerKey];
    if (!Array.isArray(p.tableSkinsOwned)) p.tableSkinsOwned = ["classic"];
    if (!p.selectedTableSkin) p.selectedTableSkin = "classic";
    if (!Array.isArray(p.ludoSkinsOwned)) p.ludoSkinsOwned = p.skinsOwned || ["classic"];
    if (!p.selectedLudoSkin) p.selectedLudoSkin = p.selectedSkin || "classic";
    delete p.skinsOwned;
    delete p.selectedSkin;
    writeProfiles(profiles);
  }
  return profiles[playerKey];
}
function updateProfile(playerKey, patch = {}) {
  const p = profiles[playerKey];
  if (!p) return null;
  Object.assign(p, patch, { updatedAt: new Date().toISOString() });
  writeProfiles(profiles);
  return p;
}
function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

app.get("/api/shop", (req, res) => res.json(SHOP));
app.get("/api/profile/:playerKey", (req, res) => {
  res.json(getOrCreateProfile(req.params.playerKey));
});
app.post("/api/profile/:playerKey/name", (req, res) => {
  const key = req.params.playerKey;
  const name = String(req.body?.displayName || "Player").slice(0, 24);
  getOrCreateProfile(key, name);
  res.json(updateProfile(key, { displayName: name }));
});
app.post("/api/profile/:playerKey/claim-daily", (req, res) => {
  const key = req.params.playerKey;
  const p = getOrCreateProfile(key);
  const today = todayKey();
  if (p.dailyClaim === today) return res.status(400).json({ error: "Already claimed today", profile: p });
  let streak = 1;
  if (p.dailyClaim === yesterdayKey()) streak = (p.streak || 0) + 1;
  const reward = Math.min(50 + (streak - 1) * 10, 120);
  const updated = updateProfile(key, {
    dailyClaim: today,
    streak,
    coins: p.coins + reward
  });
  res.json({ reward, profile: updated });
});

function buyCosmetic(profile, category, itemId) {
  const items = SHOP[category];
  const item = items.find(s => s.id === itemId);
  if (!item) return { error: "Item not found", status: 404 };
  const ownedKey = category === "tableSkins" ? "tableSkinsOwned" : "ludoSkinsOwned";
  if (profile[ownedKey].includes(itemId)) return { error: "Already owned", status: 400, profile };
  if (profile.coins < item.price) return { error: "Not enough coins", status: 400, profile };
  return updateProfile(profile.playerKey, {
    coins: profile.coins - item.price,
    [ownedKey]: [...profile[ownedKey], itemId]
  });
}

app.post("/api/profile/:playerKey/buy-table-skin", (req, res) => {
  const p = getOrCreateProfile(req.params.playerKey);
  const result = buyCosmetic(p, "tableSkins", String(req.body?.skinId || ""));
  if (result?.error) return res.status(result.status).json(result);
  res.json(result);
});
app.post("/api/profile/:playerKey/select-table-skin", (req, res) => {
  const key = req.params.playerKey;
  const skinId = String(req.body?.skinId || "");
  const p = getOrCreateProfile(key);
  if (!p.tableSkinsOwned.includes(skinId)) return res.status(400).json({ error: "Table skin not owned", profile: p });
  res.json(updateProfile(key, { selectedTableSkin: skinId }));
});
app.post("/api/profile/:playerKey/buy-ludo-skin", (req, res) => {
  const p = getOrCreateProfile(req.params.playerKey);
  const result = buyCosmetic(p, "ludoSkins", String(req.body?.skinId || ""));
  if (result?.error) return res.status(result.status).json(result);
  res.json(result);
});
app.post("/api/profile/:playerKey/select-ludo-skin", (req, res) => {
  const key = req.params.playerKey;
  const skinId = String(req.body?.skinId || "");
  const p = getOrCreateProfile(key);
  if (!p.ludoSkinsOwned.includes(skinId)) return res.status(400).json({ error: "Ludo skin not owned", profile: p });
  res.json(updateProfile(key, { selectedLudoSkin: skinId }));
});

function randCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function createRoom(kind = "private") {
  let roomCode = randCode();
  while (rooms.has(roomCode)) roomCode = randCode();
  const room = {
    code: roomCode,
    kind,
    players: [],
    started: false,
    currentTurn: 0,
    lastRoll: null,
    mustMove: false,
    movableTokenIds: [],
    winner: null,
    pieces: {},
    chat: [],
    turnEndsAt: null,
    turnTimer: null,
    updatedAt: Date.now()
  };
  rooms.set(roomCode, room);
  return room;
}
function clearRoomTimer(room) {
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
}
function scheduleTurnTimer(room) {
  clearRoomTimer(room);
  if (!room.started || room.winner || room.players.length === 0) return;
  room.turnEndsAt = Date.now() + TURN_SECONDS * 1000;
  room.turnTimer = setTimeout(() => {
    room.mustMove = false;
    room.movableTokenIds = [];
    room.lastRoll = null;
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    room.turnEndsAt = null;
    room.chat.push({ system: true, text: "Turn timed out. Auto-passed.", at: Date.now() });
    if (room.chat.length > 20) room.chat.shift();
    scheduleTurnTimer(room);
    broadcast(room);
  }, TURN_SECONDS * 1000);
}
function initPieces(room) {
  room.pieces = {};
  room.players.forEach((p) => {
    room.pieces[p.color] = Array.from({ length: 4 }, (_, i) => ({
      id: `${p.color}-${i}`,
      color: p.color,
      progress: -1
    }));
  });
}
function cleanRoom(room) {
  return {
    code: room.code,
    kind: room.kind,
    players: room.players.map(p => ({
      id: p.id,
      playerKey: p.playerKey,
      name: p.name,
      color: p.color,
      connected: !!p.socketId,
      profile: getOrCreateProfile(p.playerKey, p.name)
    })),
    started: room.started,
    currentTurn: room.currentTurn,
    lastRoll: room.lastRoll,
    mustMove: room.mustMove,
    movableTokenIds: room.movableTokenIds,
    winner: room.winner,
    pieces: room.pieces,
    chat: room.chat,
    turnEndsAt: room.turnEndsAt,
    turnSeconds: TURN_SECONDS
  };
}
function getBoardIndex(piece) {
  if (piece.progress < 0 || piece.progress >= 52) return null;
  return (START_INDEX[piece.color] + piece.progress) % 52;
}
function canMove(piece, roll) {
  if (piece.progress === 58) return false;
  if (piece.progress === -1) return roll === 6;
  return piece.progress + roll <= 58;
}
function getMovableTokens(room, color, roll) {
  return (room.pieces[color] || []).filter(piece => canMove(piece, roll));
}
function nextTurn(room, extraTurn) {
  if (room.winner) return;
  room.lastRoll = null;
  room.mustMove = false;
  room.movableTokenIds = [];
  if (!extraTurn && room.players.length) room.currentTurn = (room.currentTurn + 1) % room.players.length;
  room.updatedAt = Date.now();
  scheduleTurnTimer(room);
}
function handleCaptures(room, movedPiece) {
  const idx = getBoardIndex(movedPiece);
  if (idx === null || SAFE_INDICES.has(idx) || movedPiece.progress >= 52) return;
  room.players.forEach(p => {
    if (p.color === movedPiece.color) return;
    (room.pieces[p.color] || []).forEach(piece => {
      const other = getBoardIndex(piece);
      if (other === idx && piece.progress >= 0 && piece.progress < 52) piece.progress = -1;
    });
  });
}
function settleGame(room, winnerColor) {
  room.winner = winnerColor;
  room.mustMove = false;
  room.movableTokenIds = [];
  room.turnEndsAt = null;
  clearRoomTimer(room);
  room.chat.push({ system: true, text: `${winnerColor.toUpperCase()} wins the match.`, at: Date.now() });
  if (room.chat.length > 20) room.chat.shift();
  room.players.forEach(p => {
    const profile = getOrCreateProfile(p.playerKey, p.name);
    const won = p.color === winnerColor;
    updateProfile(p.playerKey, {
      wins: profile.wins + (won ? 1 : 0),
      losses: profile.losses + (won ? 0 : 1),
      gamesPlayed: profile.gamesPlayed + 1,
      coins: profile.coins + (won ? 60 : 15)
    });
  });
}
function applyMove(room, color, tokenId) {
  const player = room.players[room.currentTurn];
  if (!player || player.color !== color) return { ok: false, error: "Not your turn" };
  if (!room.mustMove) return { ok: false, error: "Roll first" };
  if (!room.movableTokenIds.includes(tokenId)) return { ok: false, error: "Illegal move" };
  const piece = (room.pieces[color] || []).find(p => p.id === tokenId);
  if (!piece) return { ok: false, error: "Piece not found" };

  const roll = room.lastRoll;
  if (piece.progress === -1) piece.progress = 0;
  else piece.progress += roll;
  handleCaptures(room, piece);

  if ((room.pieces[color] || []).every(p => p.progress === 58)) {
    settleGame(room, color);
    return { ok: true };
  }
  nextTurn(room, roll === 6);
  return { ok: true };
}
function broadcast(room) {
  io.to(room.code).emit("state", cleanRoom(room));
}
function findRoomByPlayerKey(playerKey) {
  for (const room of rooms.values()) {
    if (room.players.find(p => p.playerKey === playerKey)) return room;
  }
  return null;
}
function removePlayerFromQueue(playerKey) {
  const idx = matchmakingQueue.findIndex(q => q.playerKey === playerKey);
  if (idx >= 0) matchmakingQueue.splice(idx, 1);
}
function removePlayerFromRoom(room, playerKey) {
  clearRoomTimer(room);
  room.players = room.players.filter(p => p.playerKey !== playerKey);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  room.players.forEach((p, idx) => p.color = PLAYER_ORDER[idx]);
  if (room.started) {
    room.started = false;
    room.currentTurn = 0;
    room.lastRoll = null;
    room.mustMove = false;
    room.movableTokenIds = [];
    room.winner = null;
    room.turnEndsAt = null;
    room.pieces = {};
    room.chat.push({ system: true, text: "A player left. Match reset.", at: Date.now() });
    if (room.chat.length > 20) room.chat.shift();
  }
  room.updatedAt = Date.now();
}
function enqueueMatchmaking(socket, playerKey, name) {
  removePlayerFromQueue(playerKey);
  matchmakingQueue.push({ socketId: socket.id, playerKey, name: String(name || "Player").slice(0, 24) });
  if (matchmakingQueue.length >= 2) {
    const a = matchmakingQueue.shift();
    const b = matchmakingQueue.shift();
    const room = createRoom("public");
    [a, b].forEach((entry, idx) => {
      const s = io.sockets.sockets.get(entry.socketId);
      if (!s) return;
      const profile = getOrCreateProfile(entry.playerKey, entry.name);
      room.players.push({
        id: entry.playerKey,
        playerKey: entry.playerKey,
        socketId: s.id,
        name: String(entry.name || profile.displayName || "Player").slice(0, 24),
        color: PLAYER_ORDER[idx]
      });
      s.join(room.code);
      s.data.roomCode = room.code;
      s.data.playerKey = entry.playerKey;
      s.emit("room_joined", { roomCode: room.code, playerKey: entry.playerKey, color: PLAYER_ORDER[idx], host: idx === 0, matched: true });
    });
    broadcast(room);
  } else {
    socket.emit("queue_status", { queued: true, size: matchmakingQueue.length });
  }
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ playerKey, name }) => {
    if (!playerKey) return socket.emit("error_message", "Missing player key");
    removePlayerFromQueue(playerKey);
    const existing = findRoomByPlayerKey(playerKey);
    if (existing) removePlayerFromRoom(existing, playerKey);

    const profile = getOrCreateProfile(playerKey, name);
    const room = createRoom("private");
    room.players.push({
      id: playerKey,
      playerKey,
      socketId: socket.id,
      name: String(name || profile.displayName || "Player").slice(0, 24),
      color: PLAYER_ORDER[0]
    });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerKey = playerKey;
    socket.emit("room_joined", { roomCode: room.code, playerKey, color: PLAYER_ORDER[0], host: true });
    broadcast(room);
  });

  socket.on("join_room", ({ roomCode, playerKey, name }) => {
    if (!playerKey) return socket.emit("error_message", "Missing player key");
    removePlayerFromQueue(playerKey);
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room) return socket.emit("error_message", "Room not found");
    if (room.started) return socket.emit("error_message", "Game already started");
    if (room.players.length >= 4) return socket.emit("error_message", "Room is full");

    const existing = room.players.find(p => p.playerKey === playerKey);
    if (existing) {
      existing.socketId = socket.id;
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerKey = playerKey;
      socket.emit("room_joined", { roomCode: room.code, playerKey, color: existing.color, host: room.players[0]?.playerKey === playerKey });
      return broadcast(room);
    }
    const profile = getOrCreateProfile(playerKey, name);
    room.players.push({
      id: playerKey,
      playerKey,
      socketId: socket.id,
      name: String(name || profile.displayName || "Player").slice(0, 24),
      color: PLAYER_ORDER[room.players.length]
    });
    room.updatedAt = Date.now();
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerKey = playerKey;
    socket.emit("room_joined", { roomCode: room.code, playerKey, color: room.players[room.players.length - 1].color, host: false });
    broadcast(room);
  });

  socket.on("join_matchmaking", ({ playerKey, name }) => {
    if (!playerKey) return socket.emit("error_message", "Missing player key");
    const existing = findRoomByPlayerKey(playerKey);
    if (existing) removePlayerFromRoom(existing, playerKey);
    enqueueMatchmaking(socket, playerKey, name);
  });

  socket.on("cancel_matchmaking", ({ playerKey }) => {
    removePlayerFromQueue(playerKey);
    socket.emit("queue_status", { queued: false, size: matchmakingQueue.length });
  });

  socket.on("reconnect_session", ({ playerKey }) => {
    if (!playerKey) return;
    const room = findRoomByPlayerKey(playerKey);
    if (!room) return socket.emit("session_info", { inRoom: false });
    const player = room.players.find(p => p.playerKey === playerKey);
    if (!player) return socket.emit("session_info", { inRoom: false });
    player.socketId = socket.id;
    socket.join(room.code);
    socket.data.roomCode = room.code;
    socket.data.playerKey = playerKey;
    socket.emit("session_info", { inRoom: true, roomCode: room.code, color: player.color, host: room.players[0]?.playerKey === playerKey });
    broadcast(room);
  });

  socket.on("leave_room", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.data.playerKey) return;
    removePlayerFromRoom(room, socket.data.playerKey);
    broadcast(room);
  });

  socket.on("start_game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.players[0]?.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Only host can start");
    if (room.players.length < 2) return socket.emit("error_message", "Need at least 2 players");
    room.started = true;
    room.currentTurn = 0;
    room.lastRoll = null;
    room.mustMove = false;
    room.movableTokenIds = [];
    room.winner = null;
    room.chat.push({ system: true, text: "Match started.", at: Date.now() });
    if (room.chat.length > 20) room.chat.shift();
    initPieces(room);
    room.updatedAt = Date.now();
    scheduleTurnTimer(room);
    broadcast(room);
  });

  socket.on("roll_dice", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.winner) return;
    const current = room.players[room.currentTurn];
    if (!current || current.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Not your turn");
    if (room.mustMove) return socket.emit("error_message", "Move a token first");

    const roll = 1 + Math.floor(Math.random() * 6);
    room.lastRoll = roll;
    const movable = getMovableTokens(room, current.color, roll);
    if (movable.length === 0) nextTurn(room, roll === 6);
    else {
      room.mustMove = true;
      room.movableTokenIds = movable.map(p => p.id);
      room.updatedAt = Date.now();
      scheduleTurnTimer(room);
    }
    broadcast(room);
  });

  socket.on("move_token", ({ tokenId }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.started || room.winner) return;
    const current = room.players[room.currentTurn];
    if (!current || current.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Not your turn");
    const result = applyMove(room, current.color, tokenId);
    if (!result.ok) return socket.emit("error_message", result.error);
    broadcast(room);
  });

  socket.on("send_emoji", ({ emoji }) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.data.playerKey) return;
    if (!SHOP.emojis.includes(emoji)) return;
    const player = room.players.find(p => p.playerKey === socket.data.playerKey);
    if (!player) return;
    room.chat.push({ system: false, name: player.name, emoji, at: Date.now() });
    if (room.chat.length > 20) room.chat.shift();
    broadcast(room);
  });

  socket.on("reset_game", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    if (room.players[0]?.playerKey !== socket.data.playerKey) return socket.emit("error_message", "Only host can reset");
    room.started = false;
    room.currentTurn = 0;
    room.lastRoll = null;
    room.mustMove = false;
    room.movableTokenIds = [];
    room.winner = null;
    room.turnEndsAt = null;
    room.pieces = {};
    clearRoomTimer(room);
    room.chat.push({ system: true, text: "Match reset.", at: Date.now() });
    if (room.chat.length > 20) room.chat.shift();
    room.updatedAt = Date.now();
    broadcast(room);
  });

  socket.on("disconnect", () => {
    removePlayerFromQueue(socket.data.playerKey);
    const room = rooms.get(socket.data.roomCode);
    if (!room || !socket.data.playerKey) return;
    const player = room.players.find(p => p.playerKey === socket.data.playerKey);
    if (player) player.socketId = null;
    room.updatedAt = Date.now();
    broadcast(room);
  });
});

server.listen(PORT, () => {
  console.log(`Ludo MVP v4.1 running on http://localhost:${PORT}`);
});
