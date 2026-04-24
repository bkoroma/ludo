# Ludo Club v5

A full Ludo Club clone built as a drop-in Hub mini-game for AfriBConnect.
Based on your `ludo_mvp_v4_1` starting point, rebuilt from the engine up
with proper rules, coin economy, AI bots, power-ups, cosmetics, clubs, and
weekly leaderboards.

## What's new vs. v4.1

| Area | v4.1 | v5 |
| --- | --- | --- |
| Engine | Inline in server.js, partial rules | Pure module (`server/engine.js`), full Ludo Club ruleset, 11 unit tests |
| Three-sixes rule | Not enforced | Forfeit third 6, turn passes |
| Blockades | Not implemented | 2+ same-color on non-star square = blockade; can't land on OR pass through |
| Safe squares | Enforced as captures, not passes | Star squares + own-color start square |
| Home column | Captures possible | Captures impossible, opponents can't enter |
| Exact-number home | Not enforced | Must roll exact number for HOME (58) |
| AI | None | Heuristic bot (capture > safety > blockade > progress > avoid threats) |
| Game modes | Private rooms only | Practice vs bots, 1v1 (Bronze/Silver/Gold/Diamond), 4-player tables, Private |
| Coin economy | Flat 60/15 on settle | Buy-ins, 90/10 payouts, XP, daily bonus ladder (50→200 over 7 days) |
| Power-ups | None | Lucky Six, Reroll, Shield, Double Dice |
| Cosmetics | 4 table + 4 token skins | 6 table + 6 token + 5 dice skins (Kente, Ankara, Gemstone, etc.) |
| Clubs | None | Create (500 coins), join, leave, chat, gift coins |
| Leaderboards | None | Weekly + all-time, auto-rollover |
| UI | Single panel | Tabs (Lobby / Game / Shop / Clubs / Ranks), mobile-responsive |
| Board rendering | Single theme | 6 themed table skins, home columns, star markers, center crest |
| Token rendering | 4 skins (hardcoded) | 6 token skins with unique visual styles |
| Animations | None | Dice roll, token pulse on movable, capture particle burst, win confetti |
| Input | Click only | Click + mouse hover highlight + touch support |
| Security | Basic | Server-authoritative moves, per-action rate limits, sanitized names/chat, playerKey format validation |
| Profile storage | Single file, direct writes | Atomic file writes (tmp+rename), explicit migration from v4.1 shape |

## Project layout

```
ludo_club_v5/
├── package.json
├── server.js                   # Express + Socket.IO, rooms, matchmaking, bot driver
├── server/
│   ├── engine.js               # Pure Ludo rules engine, no I/O
│   ├── engine.test.js          # 11 unit tests (run with: node server/engine.test.js)
│   ├── selfplay.js             # 20-game AI self-play sanity check
│   ├── e2e_test.js             # Full socket integration test
│   ├── catalog.js              # Tables, cosmetics, power-ups, coin packs
│   └── profiles.js             # File-backed profile + clubs store
├── public/
│   ├── index.html              # Tabbed shell
│   ├── style.css               # Full design system (dark + gold/coral/emerald)
│   ├── board.js                # Canvas board + token + FX rendering
│   └── app.js                  # Socket wiring, tab renderers, shop, clubs, ranks
└── data/
    ├── profiles.json           # Persistent profiles (migrated from v4.1 shape)
    └── clubs.json              # Persistent clubs
```

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

To run the tests:

```bash
node server/engine.test.js   # unit tests (11)
node server/selfplay.js      # 20 AI-vs-AI games to completion
```

## Architecture notes

### Engine is pure
`server/engine.js` has no dependencies on Express, sockets, file I/O, or timers.
It takes a state + an RNG function and returns results. This makes it
testable in isolation (see `engine.test.js`) and straightforward to port
into the AfriBConnect Hub in Stage 2 — you just need to supply a network
transport.

### Server-authoritative everything
The client never calculates legal moves, captures, wins, or payouts. The
server validates every `roll_dice` / `move_token` / `use_powerup` against
the engine. The client renders whatever state the server broadcasts. This
matches the AfriBConnect security posture — all mutations go through
audited server code.

### Rate limiting
Per-player, per-action in-memory limiter (`rateLimit()`). Caps:
- `roll` / `move` — 60/120 per minute (well above human play speed; catches bots)
- `emoji` / `quick_chat` — 20 per 10s
- `create_room` / `join_room` — 10/20 per minute
- `gift` — 10 per minute

Map is GC'd every minute to avoid unbounded growth.

### Migrations
`profiles.js#migrate` transparently upgrades old v4.1 profile shapes:
- `skinsOwned` → `tokenSkinsOwned`
- `selectedSkin` → `selectedTokenSkin`
- `ludoSkinsOwned`/`selectedLudoSkin` folded into token skins
- Adds new fields (xp, capturesTotal, clubId, powerUps, weeklyStats)

Old profiles work immediately after upgrade; no data loss.

### Power-ups
Resolved server-side via the engine's RNG injection point. `Lucky Six`
sets `room.pendingPowerup`, and `getRngForRoom()` intercepts the next
roll to return 6. `Shield` wraps `moveToken` in a snapshot/rollback that
undoes exactly one capture against the shielded color. `Reroll` discards
the current roll state and rerolls (decrementing the 6-streak so it
doesn't count against the 3-sixes rule). `Double Dice` rolls twice and
picks the higher value.

### Matchmaking
Separate queue per table ID. When the queue hits `need` players (2 for
1v1 tables, 4 for 4-player tables) it spawns a room and auto-starts.
Practice tables bypass matchmaking and fill with bots immediately.

### Bot pacing
`BOT_THINK_MS = 900` by default — feels natural and prevents bots from
crushing the server. Lower it for development/testing; higher for a more
"deliberate" opponent feel.

## Known quirks / future work

- The `BOT_THINK_MS`-based bot loop means a 4-bot Ludo match can take
  several minutes real-time (as does Ludo Club itself). For stress
  testing, drop the constant to 10ms.
- Tournament Mode from Ludo Club is not yet implemented — the table
  system is designed to support it (add a `tournament: true` flag).
- `buy-coins` is a stub — in production, wire it to a Paystack/
  Flutterwave webhook that credits coins only after verifying the payment.
- Weekly leaderboard rollover is lazy (on profile access). A cron
  endpoint could force rollover at week boundaries if you want precise
  reset timing.

## Stage 2 (next)

An `afribconnect_hub_integration/` module that:
- Exposes the engine as a client-side module (no Node server required)
- Wires to AfriBConnect's existing coin wallet (`v122_brand_gifts.js` style
  integration)
- Uses PBKDF2-SHA256-authed profiles instead of raw player keys
- Sends game-complete / club-invite notifications via BroadcastChannel
- Drops into the Hub alongside Truth and Dare as another mini-game tile

## Credits

- Rules reference: Ludo Club (Moonfrog), Wikipedia Ludo, Zupee/Ludo365/
  LudoFantasy rule guides
- Built on top of your v4.1 MVP — core socket room pattern, file-backed
  profiles, matchmaking queue all carry forward
