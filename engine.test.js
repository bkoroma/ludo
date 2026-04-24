// Quick engine smoke tests. Run with: node server/engine.test.js
const E = require("./engine");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("  ✓", name); pass++; }
  catch (e) { console.log("  ✗", name, "—", e.message); fail++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assert failed"); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || "assertEq"}: ${a} !== ${b}`); }

// Fixed RNG helper
const queue = (rolls) => { let i = 0; return () => rolls[i++ % rolls.length]; };

console.log("Engine tests");

t("createGameState initializes 4 pieces per color at base", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  assertEq(s.pieces.red.length, 4);
  assertEq(s.pieces.blue.length, 4);
  for (const p of s.pieces.red) assertEq(p.progress, E.BASE);
});

t("cannot unlock without rolling a 6", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  const r = E.rollDice(s, () => 3);
  assert(r.ok);
  assertEq(r.passed, true);        // no legal move
  assertEq(s.currentTurn, 1);      // passes to blue
});

t("rolling 6 unlocks and grants bonus turn", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  E.rollDice(s, () => 6);
  const tokenId = s.movableTokenIds[0];
  E.moveToken(s, "red", tokenId);
  assertEq(s.currentTurn, 0); // still red's turn (bonus)
  const piece = s.pieces.red.find(p => p.id === tokenId);
  assertEq(piece.progress, 0);
});

t("three 6s in a row: turn forfeited, 3rd cancelled, no capture occurs", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  // Roll 6, unlock, move piece to progress 0
  E.rollDice(s, () => 6);
  E.moveToken(s, "red", s.movableTokenIds[0]);
  assertEq(s.sixesThisTurn, 1);
  // Roll 6 again, move piece to progress 6
  E.rollDice(s, () => 6);
  E.moveToken(s, "red", s.movableTokenIds[0]);
  assertEq(s.sixesThisTurn, 2);
  // Third 6 — must forfeit
  const r = E.rollDice(s, () => 6);
  assertEq(r.threeSixes, true);
  assertEq(r.passed, true);
  assertEq(s.currentTurn, 1); // blue's turn now
  assertEq(s.sixesThisTurn, 0);
});

t("capture on an unsafe square sends opponent to base and grants bonus", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  // Red start=0, blue start=39. Target ring 20 (unsafe).
  // Red progress 19 -> ring 19; after +1 -> ring 20.
  // Blue progress to reach ring 20 = (20 - 39 + 52) % 52 = 33
  s.pieces.red[0].progress = 19;
  s.pieces.blue[0].progress = 33; // sitting on ring 20
  s.currentTurn = 0; // red to move
  E.rollDice(s, () => 1);
  // Red must move the token at progress 19 by 1 to land on ring 20 (unsafe)
  const r = E.moveToken(s, "red", "red-0");
  assertEq(r.ok, true);
  assertEq(r.captures.length, 1);
  assertEq(r.captures[0].color, "blue");
  assertEq(s.pieces.blue[0].progress, E.BASE); // back to base
  assertEq(s.currentTurn, 0); // bonus turn
});

t("cannot capture on a star-safe square", () => {
  // Ring index 8 is a safe square.
  const s = E.createGameState({ colors: ["red", "blue"] });
  // Red progress 7 -> ring 7; after +1 -> ring 8 (safe).
  s.pieces.red[0].progress = 7;
  // Blue on ring 8: blue start 39, progress (8-39+52)%52 = 21.
  s.pieces.blue[0].progress = 21;
  s.currentTurn = 0;
  E.rollDice(s, () => 1);
  const r = E.moveToken(s, "red", "red-0");
  // Landing on ring 8 (safe) — NO capture.
  assertEq(r.captures.length, 0);
  assertEq(s.pieces.blue[0].progress, 21);
});

t("blockade: cannot land on or pass through 2 same-color opponents on ring", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  // Blue start=39. Target ring 20 needs blue progress (20-39+52)%52 = 33.
  s.pieces.blue[0].progress = 33;
  s.pieces.blue[1].progress = 33;
  // Red at ring 17: red start=0, progress 17.
  s.pieces.red[0].progress = 17;
  s.currentTurn = 0;
  // Red rolls 3 — would land on ring 20 (blue blockade).
  const movable = E.getMovableTokens(s, "red", 3);
  const redZero = movable.find(p => p.id === "red-0");
  assert(!redZero, "red-0 should be blocked from landing on blue blockade");
  // Red rolls 5 — would pass THROUGH ring 20, also blocked.
  const movable2 = E.getMovableTokens(s, "red", 5);
  const redZero2 = movable2.find(p => p.id === "red-0");
  assert(!redZero2, "red-0 should be blocked from passing through blockade");
});

t("must roll exact number to reach HOME (58)", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  s.pieces.red[0].progress = 56; // 2 away from HOME
  s.currentTurn = 0;
  // Rolling 3 would overshoot — not a legal move
  const movable = E.getMovableTokens(s, "red", 3);
  assert(!movable.find(p => p.id === "red-0"));
  // Rolling 2 lands on HOME
  const m2 = E.getMovableTokens(s, "red", 2);
  assert(m2.find(p => p.id === "red-0"));
});

t("winning when all 4 tokens reach HOME", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  s.pieces.red[0].progress = 58;
  s.pieces.red[1].progress = 58;
  s.pieces.red[2].progress = 58;
  s.pieces.red[3].progress = 57; // one away
  s.currentTurn = 0;
  E.rollDice(s, () => 1);
  const r = E.moveToken(s, "red", "red-3");
  assertEq(r.winner, "red");
  assertEq(s.winner, "red");
});

t("AI picks a capture when available", () => {
  const s = E.createGameState({ colors: ["red", "blue"] });
  // Red at ring 19 (progress 19), blue victim at ring 20 (blue start=39, progress 33).
  s.pieces.red[0].progress = 19;
  s.pieces.blue[0].progress = 33;
  s.currentTurn = 0;
  E.rollDice(s, () => 1);
  const choice = E.chooseAiMove(s, "red");
  assertEq(choice, "red-0", "AI should pick the capture");
});

t("seeded RNG is deterministic", () => {
  const r1 = E.makeSeededRng(42);
  const r2 = E.makeSeededRng(42);
  for (let i = 0; i < 100; i++) assertEq(r1(), r2());
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
