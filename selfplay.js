// Pure engine self-play, no network. 4 AI bots play until a winner.
// Catches bugs in engine + AI without going through socket.io.
const E = require("./engine");

function playOne(seed, maxTurns = 2000) {
  const colors = ["red", "green", "yellow", "blue"];
  const state = E.createGameState({ colors });
  const rng = E.makeSeededRng(seed);
  let turns = 0;
  while (!state.winner && turns < maxTurns) {
    const current = state.colors[state.currentTurn];
    if (!state.mustMove) {
      E.rollDice(state, rng);
    } else {
      const choice = E.chooseAiMove(state, current);
      if (!choice) {
        // Shouldn't happen — mustMove means >=1 legal move
        throw new Error("AI returned no choice but mustMove=true — " + JSON.stringify({
          current, lastRoll: state.lastRoll, movable: state.movableTokenIds
        }));
      }
      E.moveToken(state, current, choice);
    }
    turns++;
  }
  return { winner: state.winner, turns };
}

let maxTurns = 0, wins = { red: 0, green: 0, yellow: 0, blue: 0 }, nulls = 0;
for (let seed = 1; seed <= 20; seed++) {
  const r = playOne(seed);
  if (!r.winner) { nulls++; continue; }
  wins[r.winner]++;
  maxTurns = Math.max(maxTurns, r.turns);
  console.log(`seed=${seed}: ${r.winner} wins in ${r.turns} turns`);
}

console.log("");
console.log("Summary:", wins, "nulls:", nulls, "max turns:", maxTurns);
if (nulls > 0) process.exit(1);
