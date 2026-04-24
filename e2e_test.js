// End-to-end test: connect as a "player", create a Practice room (which
// auto-fills with bots), start the match, and play until someone wins.
// Caps turns at 2000 to catch infinite-loop bugs.

const { io } = require("socket.io-client");
const socket = io("http://localhost:3000", { reconnection: false });

const playerKey = "e2e_tester_" + Date.now();
let myColor = null;
let roomCode = null;
let lastTurnSeen = -1;
let turnCount = 0;
let gotWinner = false;
let sentRollForThisTurn = false;
let startedAt = Date.now();

socket.on("connect", () => {
  console.log("[client] connected");
  socket.emit("hello", { playerKey, name: "E2E Tester" });
  setTimeout(() => {
    socket.emit("create_room", { playerKey, name: "E2E Tester", tableId: "practice" });
  }, 100);
});

socket.on("room_joined", ({ roomCode: rc, color, host }) => {
  roomCode = rc;
  myColor = color;
  console.log(`[client] joined ${rc} as ${color}, host=${host}`);
  setTimeout(() => socket.emit("start_game"), 200);
});

socket.on("error_message", (msg) => {
  console.error("[server error]", msg);
});

socket.on("state", (s) => {
  console.log(`[state] started=${s.started} winner=${s.winner} players=${s.players.length} hasGame=${!!s.game} turnColor=${s.game?.currentColor || "-"} mustMove=${s.game?.mustMove}`);

  if (!s.started && !s.winner) return;

  if (s.winner && !gotWinner) {
    gotWinner = true;
    const me = s.players.find(p => p.playerKey === playerKey);
    console.log(`[client] WINNER: ${s.winner} — you are ${me?.color} (${me?.color === s.winner ? "WON" : "LOST"})`);
    console.log(`[client] total turns: ${turnCount}, elapsed: ${((Date.now() - startedAt)/1000).toFixed(1)}s`);
    console.log(`[client] final chat tail:`, s.chat.slice(-3).map(c => c.text || `${c.from}:${c.emoji||c.text}`));
    setTimeout(() => {
      socket.disconnect();
      process.exit(0);
    }, 500);
    return;
  }

  if (!s.game) return;

  // Track new turns (only our turn requires action from this client)
  if (s.game.currentTurn !== lastTurnSeen) {
    lastTurnSeen = s.game.currentTurn;
    turnCount++;
    sentRollForThisTurn = false;
    if (turnCount >= 2000) {
      console.error("[client] turn limit hit — aborting");
      console.error(JSON.stringify(s.game, null, 2).slice(0, 1200));
      process.exit(2);
    }
  }

  const currentColor = s.game.currentColor;
  if (currentColor !== myColor) return; // bot's turn — server drives it

  // It's our turn. Roll if we haven't, else move.
  if (s.game.mustMove) {
    const pick = s.game.movableTokenIds[0];
    setTimeout(() => socket.emit("move_token", { tokenId: pick }), 30);
  } else if (!sentRollForThisTurn) {
    sentRollForThisTurn = true;
    setTimeout(() => socket.emit("roll_dice"), 30);
  }
});

socket.on("disconnect", (r) => console.log("[client] disconnected:", r));

setTimeout(() => {
  if (!gotWinner) {
    console.error("[client] 60s timeout, no winner");
    process.exit(3);
  }
}, 60_000);
