// Catalog: tables (stakes), cosmetics (table/token/dice skins), power-ups,
// coin packs, daily bonus ladder. Afri-flavored where it fits.

const TABLES = [
  // kind: "2p" (1v1) or "4p" (four player). Buy-in subtracted up-front,
  // winner gets pot * 0.9 (10% rake), losers get participation crumbs.
  { id: "practice",   name: "Practice",         buyIn: 0,    kind: "4p", bot: true,  minLevel: 0 },
  { id: "bronze_1v1", name: "Bronze 1v1",       buyIn: 50,   kind: "2p", bot: false, minLevel: 0 },
  { id: "silver_1v1", name: "Silver 1v1",       buyIn: 200,  kind: "2p", bot: false, minLevel: 1 },
  { id: "gold_1v1",   name: "Gold 1v1",         buyIn: 800,  kind: "2p", bot: false, minLevel: 3 },
  { id: "diamond_1v1",name: "Diamond 1v1",      buyIn: 3000, kind: "2p", bot: false, minLevel: 6 },
  { id: "bronze_4p",  name: "Bronze 4-Player",  buyIn: 50,   kind: "4p", bot: false, minLevel: 0 },
  { id: "silver_4p",  name: "Silver 4-Player",  buyIn: 200,  kind: "4p", bot: false, minLevel: 1 },
  { id: "gold_4p",    name: "Gold 4-Player",    buyIn: 800,  kind: "4p", bot: false, minLevel: 3 }
];

const TABLE_SKINS = [
  { id: "classic",  name: "Classic White",      price: 0,    theme: "classic" },
  { id: "wood",     name: "Teak Wood",          price: 140,  theme: "wood" },
  { id: "emerald",  name: "Emerald Velvet",     price: 180,  theme: "emerald" },
  { id: "royal",    name: "Royal Purple",       price: 260,  theme: "royal" },
  { id: "savanna",  name: "Savanna Sunset",     price: 320,  theme: "savanna" },
  { id: "kente",    name: "Kente Weave",        price: 500,  theme: "kente" }
];

const TOKEN_SKINS = [
  { id: "classic", name: "Classic Tokens", price: 0 },
  { id: "marble",  name: "Marble Tokens",  price: 120 },
  { id: "neon",    name: "Neon Tokens",    price: 180 },
  { id: "gold",    name: "Gold Tokens",    price: 260 },
  { id: "gem",     name: "Gemstone Tokens",price: 400 },
  { id: "ankara",  name: "Ankara Print",   price: 600 }
];

const DICE_SKINS = [
  { id: "classic",   name: "Classic Dice",     price: 0 },
  { id: "ember",     name: "Ember Dice",       price: 150 },
  { id: "ocean",     name: "Ocean Dice",       price: 150 },
  { id: "aurora",    name: "Aurora Dice",      price: 300 },
  { id: "legendary", name: "Legendary Dice",   price: 800 }
];

const POWER_UPS = [
  // Consumables. Server resolves; client just requests.
  { id: "lucky_six",    name: "Lucky Six",     price: 40,  desc: "Next roll is guaranteed a 6." },
  { id: "reroll",       name: "Reroll",        price: 20,  desc: "Discard your current roll and roll again." },
  { id: "shield",       name: "Shield",        price: 60,  desc: "Next capture against you is blocked." },
  { id: "double_dice",  name: "Double Dice",   price: 80,  desc: "Roll twice, use either value, or sum." }
];

const COIN_PACKS = [
  // In a real deployment these hit Stripe/Paystack/Flutterwave.
  // Here we expose IDs so the client can render a shop.
  { id: "handful",  name: "Handful",        coins: 500,    price_usd: 0.99 },
  { id: "pouch",    name: "Pouch",          coins: 2800,   price_usd: 4.99 },
  { id: "sack",     name: "Sack",           coins: 6500,   price_usd: 9.99 },
  { id: "chest",    name: "Chest",          coins: 14500,  price_usd: 19.99 },
  { id: "vault",    name: "Vault",          coins: 40000,  price_usd: 49.99 }
];

// Emojis / quick chat (hard-coded allowlist, per your house rule: never
// trust client strings, always allowlist).
const EMOJIS = ["😀","🎲","🔥","😎","👏","😡","💥","👑","🎉","🙏","😴","🤝"];
const QUICK_CHAT = [
  "Good game!",
  "Nice move.",
  "Roll a 6!",
  "So close.",
  "Sorry!",
  "Oof.",
  "Let's go!",
  "Well played."
];

// Daily bonus ladder. Index 0 = day 1, capped at index 6 (day 7+).
const DAILY_LADDER = [50, 60, 75, 95, 120, 150, 200];

// Payout calculator (90% of pot to winner; 10% rake for the house).
function calculatePayout(buyIn, numPlayers) {
  if (!buyIn || buyIn <= 0) return { winner: 0, loser: 0, rake: 0 };
  const pot = buyIn * numPlayers;
  const winner = Math.floor(pot * 0.9);
  const rake = pot - winner;
  return { winner, loser: 0, rake, pot };
}

function dailyRewardFor(streakDay) {
  const idx = Math.min(Math.max(0, streakDay - 1), DAILY_LADDER.length - 1);
  return DAILY_LADDER[idx];
}

function levelFromXp(xp) {
  // Simple curve: level n requires 150 * n^1.5 xp cumulative.
  let lvl = 0;
  while (xp >= Math.floor(150 * Math.pow(lvl + 1, 1.5))) {
    xp -= Math.floor(150 * Math.pow(lvl + 1, 1.5));
    lvl++;
    if (lvl > 99) break;
  }
  return lvl;
}

module.exports = {
  TABLES, TABLE_SKINS, TOKEN_SKINS, DICE_SKINS, POWER_UPS,
  COIN_PACKS, EMOJIS, QUICK_CHAT, DAILY_LADDER,
  calculatePayout, dailyRewardFor, levelFromXp
};
