const socket = io();
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");

const $ = id => document.getElementById(id);
const nameInput = $("nameInput"), saveNameBtn = $("saveNameBtn"), claimDailyBtn = $("claimDailyBtn");
const createBtn = $("createBtn"), matchBtn = $("matchBtn"), cancelMatchBtn = $("cancelMatchBtn");
const roomInput = $("roomInput"), joinBtn = $("joinBtn"), leaveBtn = $("leaveBtn");
const startBtn = $("startBtn"), rollBtn = $("rollBtn"), resetBtn = $("resetBtn");
const playerKeyLabel = $("playerKeyLabel"), coinsLabel = $("coinsLabel"), winsLabel = $("winsLabel");
const lossesLabel = $("lossesLabel"), gamesLabel = $("gamesLabel"), streakLabel = $("streakLabel");
const tableSkinLabel = $("tableSkinLabel"), ludoSkinLabel = $("ludoSkinLabel"), queueLabel = $("queueLabel"), roomLabel = $("roomLabel");
const youLabel = $("youLabel"), turnLabel = $("turnLabel"), rollLabel = $("rollLabel");
const timerLabel = $("timerLabel"), statusLabel = $("statusLabel"), playerList = $("playerList");
const emojiRow = $("emojiRow"), chatLog = $("chatLog"), tableShopList = $("tableShopList"), ludoShopList = $("ludoShopList"), toast = $("toast");

const COLOR_BASE = {
  red: "#e74c3c", green: "#2ecc71", yellow: "#f1c40f", blue: "#3498db",
  line: "#d0d7de", safe: "#dde4e7"
};
const TABLE_THEMES = {
  classic: { bg: "#ffffff", inner: "#fbfbfb", safe: "#dde4e7", line: "#d0d7de", shadow: "rgba(0,0,0,0.35)" },
  wood: { bg: "#ead7bd", inner: "#f6eadb", safe: "#d8c3a6", line: "#8c6b43", shadow: "rgba(84,58,24,0.4)" },
  emerald: { bg: "#dff8ef", inner: "#effdf8", safe: "#b9ead5", line: "#278f6d", shadow: "rgba(25,80,61,0.4)" },
  royal: { bg: "#efe8ff", inner: "#f8f5ff", safe: "#d9cbff", line: "#6b54c6", shadow: "rgba(46,31,95,0.45)" }
};
const LUDO_THEME_ACCENTS = {
  classic: null,
  marble: "#ecf0f1",
  neon: "#54f7ff",
  gold: "#ffd76a"
};
const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };
const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

let me = { playerKey: null, color: null, roomCode: null };
let profile = null;
let shop = { tableSkins: [], ludoSkins: [], emojis: [] };
let queued = false;
let state = { players: [], started: false, currentTurn: 0, lastRoll: null, mustMove: false, movableTokenIds: [], winner: null, pieces: {}, chat: [], turnEndsAt: null };

function ensurePlayerKey() {
  let key = localStorage.getItem("ludo_player_key");
  if (!key) {
    key = "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem("ludo_player_key", key);
  }
  me.playerKey = key;
  playerKeyLabel.textContent = key;
}
async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
async function fetchProfile() {
  profile = await getJSON(`/api/profile/${me.playerKey}`);
  renderProfile();
}
async function fetchShop() {
  shop = await getJSON(`/api/shop`);
  renderShops();
  renderEmojis();
}
async function saveName() {
  profile = await getJSON(`/api/profile/${me.playerKey}/name`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: (nameInput.value || "Player").trim().slice(0, 24) || "Player" })
  });
  renderProfile();
  show("Name saved");
}
async function claimDaily() {
  try {
    const data = await getJSON(`/api/profile/${me.playerKey}/claim-daily`, { method: "POST" });
    profile = data.profile;
    renderProfile();
    show(`Daily reward claimed: +${data.reward} coins`);
  } catch (e) {
    show(e.message);
  }
}
async function buyTableSkin(skinId) {
  try {
    profile = await getJSON(`/api/profile/${me.playerKey}/buy-table-skin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skinId })
    });
    renderProfile(); renderShops(); draw();
    show(`Bought ${skinId} table`);
  } catch (e) { show(e.message); }
}
async function selectTableSkin(skinId) {
  try {
    profile = await getJSON(`/api/profile/${me.playerKey}/select-table-skin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skinId })
    });
    renderProfile(); renderShops(); draw();
    show(`Selected ${skinId} table`);
  } catch (e) { show(e.message); }
}
async function buyLudoSkin(skinId) {
  try {
    profile = await getJSON(`/api/profile/${me.playerKey}/buy-ludo-skin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skinId })
    });
    renderProfile(); renderShops(); draw();
    show(`Bought ${skinId} ludo skin`);
  } catch (e) { show(e.message); }
}
async function selectLudoSkin(skinId) {
  try {
    profile = await getJSON(`/api/profile/${me.playerKey}/select-ludo-skin`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skinId })
    });
    renderProfile(); renderShops(); draw();
    show(`Selected ${skinId} ludo skin`);
  } catch (e) { show(e.message); }
}
function renderProfile() {
  if (!profile) return;
  nameInput.value = profile.displayName || "Player";
  coinsLabel.textContent = profile.coins;
  winsLabel.textContent = profile.wins;
  lossesLabel.textContent = profile.losses;
  gamesLabel.textContent = profile.gamesPlayed;
  streakLabel.textContent = profile.streak || 0;
  tableSkinLabel.textContent = profile.selectedTableSkin || "classic";
  ludoSkinLabel.textContent = profile.selectedLudoSkin || "classic";
}
function renderShopList(listEl, items, ownedIds, selectedId, buyFn, selectFn) {
  listEl.innerHTML = "";
  items.forEach(item => {
    const owned = ownedIds?.includes(item.id);
    const selected = selectedId === item.id;
    const el = document.createElement("div");
    el.className = "shop-item" + (selected ? " active" : "");
    el.innerHTML = `
      <div class="shop-head"><strong>${item.name}</strong><span class="theme-chip">${item.price} coins</span></div>
      <div class="shop-actions">
        <button ${owned ? "disabled" : ""} data-buy="${item.id}">${owned ? "Owned" : "Buy"}</button>
        <button class="secondary" ${!owned || selected ? "disabled" : ""} data-select="${item.id}">${selected ? "Selected" : "Select"}</button>
      </div>
    `;
    listEl.appendChild(el);
  });
  listEl.querySelectorAll("[data-buy]").forEach(btn => btn.onclick = () => buyFn(btn.dataset.buy));
  listEl.querySelectorAll("[data-select]").forEach(btn => btn.onclick = () => selectFn(btn.dataset.select));
}
function renderShops() {
  renderShopList(tableShopList, shop.tableSkins || [], profile?.tableSkinsOwned || [], profile?.selectedTableSkin, buyTableSkin, selectTableSkin);
  renderShopList(ludoShopList, shop.ludoSkins || [], profile?.ludoSkinsOwned || [], profile?.selectedLudoSkin, buyLudoSkin, selectLudoSkin);
}
function renderEmojis() {
  emojiRow.innerHTML = "";
  (shop.emojis || []).forEach(emoji => {
    const btn = document.createElement("button");
    btn.className = "emoji-btn secondary";
    btn.textContent = emoji;
    btn.onclick = () => socket.emit("send_emoji", { emoji });
    emojiRow.appendChild(btn);
  });
}
function renderChat() {
  chatLog.innerHTML = "";
  (state.chat || []).slice(-20).forEach(msg => {
    const div = document.createElement("div");
    div.className = "chat-item" + (msg.system ? " system" : "");
    div.textContent = msg.system ? msg.text : `${msg.name}: ${msg.emoji}`;
    chatLog.appendChild(div);
  });
  chatLog.scrollTop = chatLog.scrollHeight;
}

function show(msg) {
  toast.textContent = msg;
  setTimeout(() => { if (toast.textContent === msg) toast.textContent = ""; }, 3000);
}
function capitalize(s) { return (s || "").charAt(0).toUpperCase() + (s || "").slice(1); }

ensurePlayerKey();
Promise.all([fetchProfile(), fetchShop()]).then(() => {
  socket.emit("reconnect_session", { playerKey: me.playerKey });
});

saveNameBtn.onclick = saveName;
claimDailyBtn.onclick = claimDaily;
createBtn.onclick = () => { queued = false; queueLabel.textContent = "idle"; socket.emit("create_room", { playerKey: me.playerKey, name: nameInput.value.trim() || profile?.displayName || "Player" }); };
matchBtn.onclick = () => { queued = true; queueLabel.textContent = "queued"; socket.emit("join_matchmaking", { playerKey: me.playerKey, name: nameInput.value.trim() || profile?.displayName || "Player" }); };
cancelMatchBtn.onclick = () => socket.emit("cancel_matchmaking", { playerKey: me.playerKey });
joinBtn.onclick = () => { queued = false; queueLabel.textContent = "idle"; socket.emit("join_room", { roomCode: roomInput.value.trim().toUpperCase(), playerKey: me.playerKey, name: nameInput.value.trim() || profile?.displayName || "Player" }); };
leaveBtn.onclick = () => socket.emit("leave_room");
startBtn.onclick = () => socket.emit("start_game");
rollBtn.onclick = () => socket.emit("roll_dice");
resetBtn.onclick = () => socket.emit("reset_game");

socket.on("queue_status", payload => {
  queued = !!payload.queued;
  queueLabel.textContent = queued ? `queued (${payload.size})` : "idle";
});
socket.on("room_joined", payload => {
  queued = false;
  queueLabel.textContent = "matched";
  me.roomCode = payload.roomCode;
  me.color = payload.color;
  roomLabel.textContent = payload.roomCode;
  youLabel.textContent = capitalize(payload.color);
  if (payload.matched) show(`Match found: ${payload.roomCode}`);
  else show(`Joined room ${payload.roomCode} as ${capitalize(payload.color)}`);
});
socket.on("session_info", payload => {
  if (!payload?.inRoom) return;
  me.roomCode = payload.roomCode;
  me.color = payload.color;
  roomLabel.textContent = payload.roomCode;
  youLabel.textContent = capitalize(payload.color);
  show(`Reconnected to room ${payload.roomCode}`);
});
socket.on("state", next => {
  state = next;
  const mePlayer = state.players.find(p => p.playerKey === me.playerKey);
  if (mePlayer) {
    me.color = mePlayer.color;
    me.roomCode = state.code;
    roomLabel.textContent = state.code;
    youLabel.textContent = capitalize(mePlayer.color);
    if (mePlayer.profile) { profile = mePlayer.profile; renderProfile(); renderShops(); }
  } else {
    me.roomCode = null; me.color = null;
    roomLabel.textContent = "-"; youLabel.textContent = "-";
  }
  renderChat();
  syncUI();
  draw();
});
socket.on("error_message", msg => show(msg));

canvas.addEventListener("click", (evt) => {
  if (!state.started || !state.mustMove || state.winner || !me.color) return;
  const current = state.players[state.currentTurn];
  if (!current || current.playerKey !== me.playerKey) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
  const x = (evt.clientX - rect.left) * scaleX, y = (evt.clientY - rect.top) * scaleY;
  const myPieces = state.pieces[me.color] || [];
  myPieces.filter(p => state.movableTokenIds.includes(p.id)).forEach((piece, i) => {
    const pos = getPiecePixel(piece, i);
    if (Math.hypot(x - pos.x, y - pos.y) <= geometry.tokenRadius + 10) socket.emit("move_token", { tokenId: piece.id });
  });
});

function syncUI() {
  playerList.innerHTML = "";
  state.players.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = `player-pill ${p.color}`;
    const turnMark = idx === state.currentTurn && state.started && !state.winner ? " • turn" : "";
    const meMark = p.playerKey === me.playerKey ? " • you" : "";
    const online = p.connected ? "" : " • offline";
    const coinText = p.profile ? ` • ${p.profile.coins} coins` : "";
    div.textContent = `${p.name} (${capitalize(p.color)})${turnMark}${meMark}${online}${coinText}`;
    playerList.appendChild(div);
  });
  const current = state.players[state.currentTurn];
  turnLabel.textContent = current ? capitalize(current.color) : "-";
  turnLabel.style.color = current ? COLOR_BASE[current.color] : "#fff";
  rollLabel.textContent = state.lastRoll ?? "-";
  if (state.turnEndsAt) timerLabel.textContent = Math.max(0, Math.ceil((state.turnEndsAt - Date.now()) / 1000)) + "s";
  else timerLabel.textContent = "-";
  if (state.winner) statusLabel.textContent = `${capitalize(state.winner)} wins`;
  else if (!state.started) statusLabel.textContent = state.kind === "public" ? "Auto-matched room ready" : "Waiting to start";
  else if (state.mustMove) statusLabel.textContent = "Select a highlighted token";
  else statusLabel.textContent = "Roll the dice";

  const isHost = state.players[0]?.playerKey === me.playerKey;
  const myTurn = current?.playerKey === me.playerKey;
  startBtn.disabled = !isHost || state.started || state.players.length < 2 || state.kind === "public";
  resetBtn.disabled = !isHost;
  rollBtn.disabled = !state.started || !myTurn || state.mustMove || !!state.winner;
  leaveBtn.disabled = !me.roomCode;
}
setInterval(() => {
  if (state.turnEndsAt) timerLabel.textContent = Math.max(0, Math.ceil((state.turnEndsAt - Date.now()) / 1000)) + "s";
}, 250);

function getTrackCells() {
  return [
    {r:6,c:1},{r:6,c:2},{r:6,c:3},{r:6,c:4},{r:6,c:5},{r:5,c:6},{r:4,c:6},{r:3,c:6},{r:2,c:6},{r:1,c:6},
    {r:0,c:6},{r:0,c:7},{r:0,c:8},{r:1,c:8},{r:2,c:8},{r:3,c:8},{r:4,c:8},{r:5,c:8},{r:6,c:9},{r:6,c:10},
    {r:6,c:11},{r:6,c:12},{r:6,c:13},{r:6,c:14},{r:7,c:14},{r:8,c:14},{r:8,c:13},{r:8,c:12},{r:8,c:11},{r:8,c:10},
    {r:8,c:9},{r:9,c:8},{r:10,c:8},{r:11,c:8},{r:12,c:8},{r:13,c:8},{r:14,c:8},{r:14,c:7},{r:14,c:6},{r:13,c:6},
    {r:12,c:6},{r:11,c:6},{r:10,c:6},{r:9,c:6},{r:8,c:5},{r:8,c:4},{r:8,c:3},{r:8,c:2},{r:8,c:1},{r:8,c:0},
    {r:7,c:0},{r:6,c:0}
  ];
}
const geometry = (() => {
  const cell = canvas.width / 15;
  const track = getTrackCells().map(({r, c}) => ({ x: (c + 0.5) * cell, y: (r + 0.5) * cell }));
  return {
    cell, track, tokenRadius: cell * 0.28,
    baseSpots: {
      red: [{x:1.75*cell,y:1.75*cell},{x:3.25*cell,y:1.75*cell},{x:1.75*cell,y:3.25*cell},{x:3.25*cell,y:3.25*cell}],
      green: [{x:11.75*cell,y:1.75*cell},{x:13.25*cell,y:1.75*cell},{x:11.75*cell,y:3.25*cell},{x:13.25*cell,y:3.25*cell}],
      yellow: [{x:11.75*cell,y:11.75*cell},{x:13.25*cell,y:11.75*cell},{x:11.75*cell,y:13.25*cell},{x:13.25*cell,y:13.25*cell}],
      blue: [{x:1.75*cell,y:11.75*cell},{x:3.25*cell,y:11.75*cell},{x:1.75*cell,y:13.25*cell},{x:3.25*cell,y:13.25*cell}]
    },
    homeLanes: {
      red: [1,2,3,4,5,6].map(c => ({x:(c+.5)*cell,y:7.5*cell})),
      green: [1,2,3,4,5,6].map(r => ({x:7.5*cell,y:(r+.5)*cell})),
      yellow: [13,12,11,10,9,8].map(c => ({x:(c+.5)*cell,y:7.5*cell})),
      blue: [13,12,11,10,9,8].map(r => ({x:7.5*cell,y:(r+.5)*cell}))
    }
  };
})();
function activeTableTheme() {
  const selected = profile?.selectedTableSkin || "classic";
  return TABLE_THEMES[selected] || TABLE_THEMES.classic;
}
function getBoardIndex(piece) {
  if (piece.progress < 0 || piece.progress >= 52) return null;
  return (START_INDEX[piece.color] + piece.progress) % 52;
}
function stackedOffset(i) {
  const offsets = [{x:0,y:0},{x:10,y:-10},{x:-10,y:10},{x:10,y:10}];
  return offsets[i % offsets.length];
}
function tokenFill(player) {
  const skin = player?.profile?.selectedLudoSkin || "classic";
  const accent = LUDO_THEME_ACCENTS[skin];
  return accent || COLOR_BASE[player.color];
}
function tokenStroke(player) {
  const skin = player?.profile?.selectedLudoSkin || "classic";
  if (skin === "gold") return "#8f6b00";
  if (skin === "neon") return "#0b5160";
  if (skin === "marble") return "#7f8c8d";
  return "#111";
}
function getPiecePixel(piece, stackIndex=0) {
  const index = Number(piece.id.split("-")[1]);
  if (piece.progress === -1) return geometry.baseSpots[piece.color][index];
  if (piece.progress === 58) return { x: 7.5 * geometry.cell + (index % 2) * 18 - 9, y: 7.5 * geometry.cell + Math.floor(index / 2) * 18 - 9 };
  if (piece.progress >= 52) return geometry.homeLanes[piece.color][piece.progress - 52];
  const base = geometry.track[getBoardIndex(piece)];
  const off = stackedOffset(stackIndex);
  return { x: base.x + off.x, y: base.y + off.y };
}
function drawCell(r, c, fill="#fff", line="#d0d7de") {
  const s = geometry.cell;
  ctx.fillStyle = fill;
  ctx.fillRect(c*s, r*s, s, s);
  ctx.strokeStyle = line;
  ctx.strokeRect(c*s, r*s, s, s);
}
function drawBoard() {
  const theme = activeTableTheme();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COLOR_BASE.red; ctx.fillRect(0, 0, 5*geometry.cell, 5*geometry.cell);
  ctx.fillStyle = COLOR_BASE.green; ctx.fillRect(10*geometry.cell, 0, 5*geometry.cell, 5*geometry.cell);
  ctx.fillStyle = COLOR_BASE.yellow; ctx.fillRect(10*geometry.cell, 10*geometry.cell, 5*geometry.cell, 5*geometry.cell);
  ctx.fillStyle = COLOR_BASE.blue; ctx.fillRect(0, 10*geometry.cell, 5*geometry.cell, 5*geometry.cell);
  ctx.fillStyle = theme.inner;
  ctx.fillRect(geometry.cell, geometry.cell, 3*geometry.cell, 3*geometry.cell);
  ctx.fillRect(11*geometry.cell, geometry.cell, 3*geometry.cell, 3*geometry.cell);
  ctx.fillRect(11*geometry.cell, 11*geometry.cell, 3*geometry.cell, 3*geometry.cell);
  ctx.fillRect(geometry.cell, 11*geometry.cell, 3*geometry.cell, 3*geometry.cell);
  getTrackCells().forEach(({r, c}) => drawCell(r, c, "#fff", theme.line));
  [1,2,3,4,5,6].forEach(c => drawCell(7, c, COLOR_BASE.red, theme.line));
  [1,2,3,4,5,6].forEach(r => drawCell(r, 7, COLOR_BASE.green, theme.line));
  [13,12,11,10,9,8].forEach(c => drawCell(7, c, COLOR_BASE.yellow, theme.line));
  [13,12,11,10,9,8].forEach(r => drawCell(r, 7, COLOR_BASE.blue, theme.line));
  SAFE_INDICES.forEach(i => {
    const p = geometry.track[i];
    ctx.fillStyle = theme.safe;
    ctx.fillRect(p.x - geometry.cell/2, p.y - geometry.cell/2, geometry.cell, geometry.cell);
    ctx.strokeStyle = theme.line;
    ctx.strokeRect(p.x - geometry.cell/2, p.y - geometry.cell/2, geometry.cell, geometry.cell);
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI*2); ctx.fillStyle = "#95a5a6"; ctx.fill();
  });
  const s = geometry.cell, cx = 7.5*s, cy = 7.5*s;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(6*s,6*s); ctx.lineTo(9*s,6*s); ctx.closePath(); ctx.fillStyle = COLOR_BASE.green; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(9*s,6*s); ctx.lineTo(9*s,9*s); ctx.closePath(); ctx.fillStyle = COLOR_BASE.blue; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(9*s,9*s); ctx.lineTo(6*s,9*s); ctx.closePath(); ctx.fillStyle = COLOR_BASE.yellow; ctx.fill();
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(6*s,9*s); ctx.lineTo(6*s,6*s); ctx.closePath(); ctx.fillStyle = COLOR_BASE.red; ctx.fill();

  const current = state.players[state.currentTurn];
  if (state.mustMove && current && current.playerKey === me.playerKey) {
    (state.pieces[me.color] || []).filter(p => state.movableTokenIds.includes(p.id)).forEach((piece, i) => {
      const pos = getPiecePixel(piece, i);
      ctx.beginPath(); ctx.arc(pos.x, pos.y, geometry.tokenRadius + 8, 0, Math.PI * 2);
      ctx.strokeStyle = "#111"; ctx.lineWidth = 4; ctx.stroke(); ctx.lineWidth = 1;
    });
  }
}
function drawPieces() {
  (state.players || []).forEach(player => {
    const pieces = state.pieces[player.color] || [];
    const groups = new Map();
    pieces.forEach(piece => {
      const key = piece.progress < 0 ? piece.id : piece.progress >= 52 ? `${piece.color}-${piece.progress}` : `track-${getBoardIndex(piece)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(piece);
    });
    groups.forEach(group => {
      group.forEach((piece, i) => {
        const p = getPiecePixel(piece, i);
        ctx.beginPath(); ctx.arc(p.x, p.y, geometry.tokenRadius, 0, Math.PI * 2);
        ctx.fillStyle = tokenFill(player);
        ctx.fill();
        ctx.strokeStyle = tokenStroke(player); ctx.lineWidth = 2; ctx.stroke();

        const ludoSkin = player?.profile?.selectedLudoSkin || "classic";
        if (ludoSkin === "marble") {
          ctx.beginPath(); ctx.arc(p.x + 3, p.y - 4, geometry.tokenRadius/4, 0, Math.PI*2);
          ctx.fillStyle = "rgba(120,120,120,0.22)"; ctx.fill();
        } else if (ludoSkin === "neon") {
          ctx.beginPath(); ctx.arc(p.x, p.y, geometry.tokenRadius + 3, 0, Math.PI*2);
          ctx.strokeStyle = "rgba(84,247,255,0.45)"; ctx.stroke();
        } else if (ludoSkin === "gold") {
          ctx.beginPath(); ctx.arc(p.x - 4, p.y - 5, geometry.tokenRadius/3, 0, Math.PI*2);
          ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(p.x - 5, p.y - 5, geometry.tokenRadius/3, 0, Math.PI*2);
          ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fill();
        }
      });
    });
  });
}
function draw() {
  drawBoard();
  drawPieces();
}
draw();
