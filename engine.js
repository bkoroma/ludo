// ============================================================================
// Ludo Engine v5 — Pure, server-authoritative game rules.
// No I/O, no sockets, no DB. Portable to AfriBConnect Hub as-is.
//
// Full Ludo Club ruleset:
//  - 52-square main track, 6-square home column per color
//  - Need a 6 to unlock a token from base
//  - Roll a 6 -> extra turn
//  - Three 6s in a row -> turn forfeited, last moved token NOT sent back
//    (we use the Ludo Club variant: cancel the 3rd roll, pass turn)
//  - Capture an opponent (land on their square) -> extra turn, their
//    token returns to base
//  - Star-marked safe squares: no captures
//  - Each color's start square is safe for that color's own pieces
//  - Two same-color tokens on one non-star square form a BLOCKADE:
//    cannot be captured by a single opponent, cannot be passed through
//  - Home column: no captures (opponents can't enter your column)
//  - Must land in the home triangle by EXACT roll
//  - First to get all 4 tokens home wins
// ============================================================================

const PLAYER_ORDER = ["red", "green", "yellow", "blue"];

// Each color's entry onto the 52-square ring.
// Ring index 0 is red's start, 13 green, 26 yellow, 39 blue.
const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };

// Star-marked safe squares (the 4 starts + 4 mid-quadrant stars).
// Indices refer to the shared 52-square ring.
const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

// Progress encoding for a single token:
//   -1          : in base (not yet on board)
//   0..51       : on the 52-square ring; board position = (START_INDEX[color] + progress) % 52
//   52..57      : in the home column (6 squares leading to the home triangle)
//   58          : in the home triangle (finished). A token at 58 is "home".
const BASE = -1;
const HOME = 58;
const HOME_COLUMN_ENTRY = 52; // first square of the home column

function createGameState({ colors }) {
  // colors: array of color strings in turn order, e.g. ["red","blue"] for 1v1
  const pieces = {};
  for (const color of colors) {
    pieces[color] = Array.from({ length: 4 }, (_, i) => ({
      id: `${color}-${i}`,
      color,
      progress: BASE
    }));
  }
  return {
    colors,                 // turn order
    currentTurn: 0,         // index into colors
    lastRoll: null,
    mustMove: false,
    movableTokenIds: [],
    sixesThisTurn: 0,       // consecutive 6s in current turn
    winner: null,           // winning color or null
    pieces,
    turn: 0,                // turn counter (for logs, never for rules)
    rngLog: []              // append-only log of {turn, color, roll} for audit
  };
}

// Board position (0..51) for a token on the ring, or null otherwise.
function getRingIndex(piece) {
  if (piece.progress < 0 || piece.progress >= HOME_COLUMN_ENTRY) return null;
  return (START_INDEX[piece.color] + piece.progress) % 52;
}

// Is a square a star-safe square? Star squares protect from captures.
function isSafeSquare(ringIndex) {
  return SAFE_INDICES.has(ringIndex);
}

// Is this piece currently sharing its ring square with another same-color
// piece? That makes a blockade. Home-column squares are never blockades
// (each home-column square is color-owned already).
function isBlockade(state, piece) {
  const idx = getRingIndex(piece);
  if (idx === null) return false;
  const mates = state.pieces[piece.color] || [];
  let count = 0;
  for (const p of mates) {
    if (p.id === piece.id) continue;
    if (getRingIndex(p) === idx) count++;
  }
  return count >= 1;
}

// Would moving this piece pass through an opponent's blockade?
// A blockade cannot be passed through by any opponent's single token.
function passesThroughBlockade(state, piece, roll) {
  if (piece.progress === BASE) return false; // entering start is handled separately
  const fromProg = piece.progress;
  const toProg = fromProg + roll;

  for (let step = 1; step <= roll; step++) {
    const prog = fromProg + step;
    if (prog >= HOME_COLUMN_ENTRY) break; // home column is opponent-free
    const ringIdx = (START_INDEX[piece.color] + prog) % 52;
    // Check each opponent for a blockade at ringIdx
    for (const color of state.colors) {
      if (color === piece.color) continue;
      const mates = state.pieces[color] || [];
      let oppCount = 0;
      for (const p of mates) {
        if (getRingIndex(p) === ringIdx) oppCount++;
      }
      if (oppCount >= 2) {
        // Final landing square counts only if we'd STOP there (blockade can't be captured)
        if (step === roll) return true;
        // Mid-path blockade: you also can't pass through
        return true;
      }
    }
  }
  return false;
}

// Can this specific token legally move with this roll?
function canMove(state, piece, roll) {
  if (piece.progress === HOME) return false;

  // Unlock from base: need a 6, and start square must not hold opponent blockade
  if (piece.progress === BASE) {
    if (roll !== 6) return false;
    // Is our start square blocked by an opponent blockade?
    const startRing = START_INDEX[piece.color];
    for (const color of state.colors) {
      if (color === piece.color) continue;
      const opps = (state.pieces[color] || []).filter(p => getRingIndex(p) === startRing);
      if (opps.length >= 2) return false;
    }
    return true;
  }

  // Already on board. Cannot overshoot HOME.
  if (piece.progress + roll > HOME) return false;

  // Cannot pass through an opponent blockade
  if (passesThroughBlockade(state, piece, roll)) return false;

  // Cannot land on a square already occupied by TWO of our own pieces would
  // be a legal stack (3 same-color on one square is legal — rules vary; Ludo
  // Club allows it). We allow stacking of your own; skip further checks.
  return true;
}

function getMovableTokens(state, color, roll) {
  return (state.pieces[color] || []).filter(p => canMove(state, p, roll));
}

// Apply a move to a token. Returns { captures: [...], reachedHome: bool }.
// Assumes move has been validated.
function applyTokenMove(state, piece, roll) {
  let reachedHome = false;
  if (piece.progress === BASE) {
    piece.progress = 0; // onto the ring
  } else {
    piece.progress += roll;
    if (piece.progress === HOME) reachedHome = true;
  }

  // Captures only possible on the 52-square ring (not in home column)
  const captures = [];
  const landedRing = getRingIndex(piece);
  if (landedRing !== null && !isSafeSquare(landedRing)) {
    // If we landed on opponents AND there are fewer than 2 of them, they're captured.
    // If there are 2+ opponents (their blockade), we could not have landed here.
    for (const color of state.colors) {
      if (color === piece.color) continue;
      const opps = (state.pieces[color] || []).filter(p => getRingIndex(p) === landedRing);
      if (opps.length === 1) {
        opps[0].progress = BASE;
        captures.push({ color, id: opps[0].id });
      }
    }
  }

  return { captures, reachedHome };
}

// Do we have a winner now?
function checkWinner(state, color) {
  const allHome = (state.pieces[color] || []).every(p => p.progress === HOME);
  return allHome ? color : null;
}

// Transition to next turn (or keep current on bonus).
function advanceTurn(state, bonus) {
  state.lastRoll = null;
  state.mustMove = false;
  state.movableTokenIds = [];
  if (bonus) {
    // Keep current player, but reset 6-streak if bonus wasn't from a 6.
    // Actually sixesThisTurn is only incremented on a 6, so leave it.
  } else {
    state.sixesThisTurn = 0;
    state.currentTurn = (state.currentTurn + 1) % state.colors.length;
  }
  state.turn += 1;
}

// Roll the dice. rng is a fn returning an int in [1..6].
// Handles the 3-sixes rule. Returns a descriptive result.
function rollDice(state, rng) {
  if (state.winner) return { ok: false, error: "Game over" };
  if (state.mustMove) return { ok: false, error: "Move a token first" };

  const roll = rng();
  state.lastRoll = roll;
  state.rngLog.push({ turn: state.turn, color: state.colors[state.currentTurn], roll });

  const currentColor = state.colors[state.currentTurn];

  if (roll === 6) {
    state.sixesThisTurn += 1;
    if (state.sixesThisTurn >= 3) {
      // Three-sixes rule (Ludo Club variant): cancel this roll, pass turn.
      state.lastRoll = null;
      state.sixesThisTurn = 0;
      advanceTurn(state, false);
      return { ok: true, roll, threeSixes: true, passed: true };
    }
  }

  const movable = getMovableTokens(state, currentColor, roll);
  if (movable.length === 0) {
    // No legal move. A 6 does NOT give a bonus turn if it can't be used.
    advanceTurn(state, false);
    return { ok: true, roll, mustMove: false, passed: true };
  }

  state.mustMove = true;
  state.movableTokenIds = movable.map(p => p.id);
  return { ok: true, roll, mustMove: true, movableTokenIds: state.movableTokenIds };
}

// Move a token by id. Validates server-side.
function moveToken(state, color, tokenId) {
  if (state.winner) return { ok: false, error: "Game over" };
  const currentColor = state.colors[state.currentTurn];
  if (color !== currentColor) return { ok: false, error: "Not your turn" };
  if (!state.mustMove) return { ok: false, error: "Roll first" };
  if (!state.movableTokenIds.includes(tokenId)) return { ok: false, error: "Illegal move" };

  const piece = (state.pieces[color] || []).find(p => p.id === tokenId);
  if (!piece) return { ok: false, error: "Token not found" };

  const roll = state.lastRoll;
  const { captures, reachedHome } = applyTokenMove(state, piece, roll);

  // Check win
  const winner = checkWinner(state, color);
  if (winner) {
    state.winner = winner;
    state.mustMove = false;
    state.movableTokenIds = [];
    state.lastRoll = null;
    return { ok: true, captures, reachedHome, winner };
  }

  // Bonus turn: rolling a 6, capturing any opponent, or getting a token home.
  const bonus = roll === 6 || captures.length > 0 || reachedHome;
  advanceTurn(state, bonus);

  return { ok: true, captures, reachedHome, bonus };
}

// ---- Default RNG (Mulberry32 seeded) so we can log & replay matches ------
function makeSeededRng(seed) {
  let s = seed >>> 0;
  return function nextD6() {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    const v = ((t ^ t >>> 14) >>> 0) / 4294967296;
    return 1 + Math.floor(v * 6);
  };
}

// ---- AI: heuristic bot ---------------------------------------------------
// Priorities (in order):
//   1. Capture an opponent (especially one closer to home)
//   2. Land on a safe square or make/join a blockade
//   3. Move the token closest to home
//   4. Unlock a new token from base (when roll === 6)
//   5. Avoid landing in the firing line of an opponent 1..6 squares behind
function chooseAiMove(state, color) {
  const roll = state.lastRoll;
  const movable = getMovableTokens(state, color, roll);
  if (movable.length === 0) return null;
  if (movable.length === 1) return movable[0].id;

  const scored = movable.map(piece => {
    let score = 0;
    const fromProg = piece.progress;
    const toProg = piece.progress === BASE ? 0 : piece.progress + roll;
    const toRing = toProg < HOME_COLUMN_ENTRY ? (START_INDEX[color] + toProg) % 52 : null;

    // 1. Capture check
    if (toRing !== null && !isSafeSquare(toRing)) {
      for (const other of state.colors) {
        if (other === color) continue;
        const opps = (state.pieces[other] || []).filter(p => getRingIndex(p) === toRing);
        if (opps.length === 1) {
          // Capture! Value higher if the captured piece was far along.
          const victim = opps[0];
          score += 100 + Math.max(0, victim.progress);
        }
      }
    }

    // 2. Reaching home
    if (toProg === HOME) score += 80;

    // 3. Entering safe square
    if (toRing !== null && isSafeSquare(toRing)) score += 25;

    // 4. Forming a blockade with a mate
    if (toRing !== null) {
      const mates = (state.pieces[color] || []).filter(p => p.id !== piece.id && getRingIndex(p) === toRing);
      if (mates.length >= 1) score += 40;
    }

    // 5. Unlocking (only when rolling a 6 and piece was in base)
    if (fromProg === BASE && roll === 6) {
      // Unlock is OK but usually prefer advancing an on-board piece first,
      // unless we have zero pieces out.
      const onBoard = (state.pieces[color] || []).filter(p => p.progress !== BASE && p.progress !== HOME).length;
      score += onBoard === 0 ? 60 : 15;
    }

    // 6. General progress
    score += toProg * 0.5;

    // 7. Danger: how many opponents sit 1..6 squares behind the landing
    //    square on the ring? Penalize exposure (unless landing is safe).
    if (toRing !== null && !isSafeSquare(toRing)) {
      let threatCount = 0;
      for (const other of state.colors) {
        if (other === color) continue;
        for (const p of state.pieces[other] || []) {
          const ringIdx = getRingIndex(p);
          if (ringIdx === null) continue;
          // distance along ring from opponent to our landing square
          const dist = (toRing - ringIdx + 52) % 52;
          if (dist >= 1 && dist <= 6) threatCount++;
        }
      }
      score -= threatCount * 8;
    }

    return { piece, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].piece.id;
}

module.exports = {
  // constants
  PLAYER_ORDER, START_INDEX, SAFE_INDICES,
  BASE, HOME, HOME_COLUMN_ENTRY,
  // state
  createGameState,
  // queries
  getRingIndex, isSafeSquare, canMove, getMovableTokens,
  checkWinner, isBlockade,
  // actions
  rollDice, moveToken,
  // ai
  chooseAiMove,
  // rng
  makeSeededRng
};
