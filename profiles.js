// Profile storage. File-backed JSON (same approach as v4.1). Safe-by-design:
// all writes go through updateProfile and are atomic from the app's POV.

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "profiles.json");
const CLUBS_FILE = path.join(DATA_DIR, "clubs.json");

function ensureFs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}");
  if (!fs.existsSync(CLUBS_FILE)) fs.writeFileSync(CLUBS_FILE, "{}");
}
ensureFs();

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return {}; } }
function writeJson(p, obj) {
  // Write to temp then rename — tiny but helpful atomicity.
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

const profiles = readJson(FILE);
const clubs = readJson(CLUBS_FILE);

function flush() { writeJson(FILE, profiles); }
function flushClubs() { writeJson(CLUBS_FILE, clubs); }

function sanitizeName(name) {
  return String(name || "Player")
    .replace(/[\u0000-\u001F\u007F]/g, "") // control chars
    .replace(/[<>"'`]/g, "")               // HTML-ish chars (defense in depth)
    .trim()
    .slice(0, 24) || "Player";
}

function newProfile(playerKey, name) {
  return {
    playerKey,
    displayName: sanitizeName(name),
    coins: 500,       // friendly starting balance
    xp: 0,
    wins: 0,
    losses: 0,
    gamesPlayed: 0,
    capturesTotal: 0,
    coinsEarnedTotal: 0,

    // Cosmetics inventory
    tableSkinsOwned: ["classic"],
    selectedTableSkin: "classic",
    tokenSkinsOwned: ["classic"],
    selectedTokenSkin: "classic",
    diceSkinsOwned: ["classic"],
    selectedDiceSkin: "classic",

    // Power-up inventory: { lucky_six: 2, shield: 0, ... }
    powerUps: {},

    // Club membership
    clubId: null,

    // Daily bonus
    dailyClaim: null,     // YYYY-MM-DD of last claim
    streak: 0,

    // Per-week stats for leaderboards
    weekKey: null,
    weeklyWins: 0,
    weeklyCoinsEarned: 0,

    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// Migration: brings an old profile up to the v5 shape.
function migrate(p) {
  if (!Array.isArray(p.tableSkinsOwned)) p.tableSkinsOwned = ["classic"];
  if (!p.selectedTableSkin) p.selectedTableSkin = "classic";
  // v4.1 used "ludoSkinsOwned" / "selectedLudoSkin" — bring forward.
  if (!Array.isArray(p.tokenSkinsOwned)) p.tokenSkinsOwned = p.ludoSkinsOwned || ["classic"];
  if (!p.selectedTokenSkin) p.selectedTokenSkin = p.selectedLudoSkin || "classic";
  if (!Array.isArray(p.diceSkinsOwned)) p.diceSkinsOwned = ["classic"];
  if (!p.selectedDiceSkin) p.selectedDiceSkin = "classic";
  if (!p.powerUps || typeof p.powerUps !== "object") p.powerUps = {};
  if (typeof p.xp !== "number") p.xp = 0;
  if (typeof p.capturesTotal !== "number") p.capturesTotal = 0;
  if (typeof p.coinsEarnedTotal !== "number") p.coinsEarnedTotal = 0;
  if (typeof p.weeklyWins !== "number") p.weeklyWins = 0;
  if (typeof p.weeklyCoinsEarned !== "number") p.weeklyCoinsEarned = 0;
  if (!("clubId" in p)) p.clubId = null;
  // Strip obsolete fields
  delete p.ludoSkinsOwned;
  delete p.selectedLudoSkin;
  delete p.skinsOwned;
  delete p.selectedSkin;
  return p;
}

function getOrCreate(playerKey, name) {
  if (!playerKey || typeof playerKey !== "string") throw new Error("Invalid playerKey");
  const key = playerKey.slice(0, 64);
  if (!profiles[key]) {
    profiles[key] = newProfile(key, name);
    flush();
  } else {
    migrate(profiles[key]);
    flush();
  }
  return profiles[key];
}

function update(playerKey, patch) {
  const p = profiles[playerKey];
  if (!p) return null;
  Object.assign(p, patch, { updatedAt: new Date().toISOString() });
  flush();
  return p;
}

function increment(playerKey, deltas) {
  const p = profiles[playerKey];
  if (!p) return null;
  for (const [k, v] of Object.entries(deltas)) {
    p[k] = (p[k] || 0) + v;
  }
  p.updatedAt = new Date().toISOString();
  flush();
  return p;
}

// ---- Date helpers ---------------------------------------------------------
function todayKey() { return new Date().toISOString().slice(0, 10); }
function yesterdayKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function weekKey() {
  // ISO week key e.g. "2026-W17"
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

// Rotate weekly stats if the current weekKey has changed for this profile.
function rollWeekIfNeeded(profile) {
  const wk = weekKey();
  if (profile.weekKey !== wk) {
    profile.weekKey = wk;
    profile.weeklyWins = 0;
    profile.weeklyCoinsEarned = 0;
  }
}

// ---- Leaderboards --------------------------------------------------------
function globalLeaderboard(limit = 20) {
  return Object.values(profiles)
    .map(p => ({
      playerKey: p.playerKey,
      displayName: p.displayName,
      wins: p.wins,
      coinsEarnedTotal: p.coinsEarnedTotal,
      xp: p.xp
    }))
    .sort((a, b) => b.xp - a.xp || b.wins - a.wins)
    .slice(0, limit);
}
function weeklyLeaderboard(limit = 20) {
  const wk = weekKey();
  return Object.values(profiles)
    .filter(p => p.weekKey === wk && p.weeklyWins > 0)
    .map(p => ({
      playerKey: p.playerKey,
      displayName: p.displayName,
      weeklyWins: p.weeklyWins,
      weeklyCoinsEarned: p.weeklyCoinsEarned
    }))
    .sort((a, b) => b.weeklyWins - a.weeklyWins || b.weeklyCoinsEarned - a.weeklyCoinsEarned)
    .slice(0, limit);
}

// ---- Clubs ----------------------------------------------------------------
function sanitizeClubName(name) {
  return String(name || "Club")
    .replace(/[\u0000-\u001F\u007F<>"'`]/g, "")
    .trim()
    .slice(0, 32) || "Club";
}

function createClub({ ownerKey, name, description }) {
  const owner = profiles[ownerKey];
  if (!owner) return { error: "No profile" };
  if (owner.clubId) return { error: "Already in a club" };
  if (owner.coins < 500) return { error: "Need 500 coins to found a club" };
  const id = "club_" + Math.random().toString(36).slice(2, 10);
  clubs[id] = {
    id,
    name: sanitizeClubName(name),
    description: sanitizeClubName(description).slice(0, 120),
    ownerKey,
    memberKeys: [ownerKey],
    chat: [],
    createdAt: new Date().toISOString()
  };
  owner.coins -= 500;
  owner.clubId = id;
  flush(); flushClubs();
  return { club: clubs[id] };
}

function joinClub({ playerKey, clubId }) {
  const p = profiles[playerKey];
  const c = clubs[clubId];
  if (!p || !c) return { error: "Not found" };
  if (p.clubId) return { error: "Already in a club" };
  if (c.memberKeys.length >= 50) return { error: "Club is full" };
  c.memberKeys.push(playerKey);
  p.clubId = clubId;
  flush(); flushClubs();
  return { club: c };
}

function leaveClub({ playerKey }) {
  const p = profiles[playerKey];
  if (!p || !p.clubId) return { error: "Not in a club" };
  const c = clubs[p.clubId];
  if (c) {
    c.memberKeys = c.memberKeys.filter(k => k !== playerKey);
    if (c.ownerKey === playerKey) {
      // Pass ownership or dissolve
      if (c.memberKeys.length > 0) c.ownerKey = c.memberKeys[0];
      else delete clubs[c.id];
    }
  }
  p.clubId = null;
  flush(); flushClubs();
  return { ok: true };
}

function postClubChat({ playerKey, text }) {
  const p = profiles[playerKey];
  if (!p || !p.clubId) return { error: "Not in a club" };
  const c = clubs[p.clubId];
  if (!c) return { error: "Club missing" };
  const clean = String(text || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>"'`]/g, "")
    .trim()
    .slice(0, 120);
  if (!clean) return { error: "Empty" };
  c.chat.push({ from: p.displayName, key: playerKey, text: clean, at: Date.now() });
  if (c.chat.length > 100) c.chat.shift();
  flushClubs();
  return { ok: true };
}

function giftCoins({ fromKey, toKey, amount }) {
  const a = profiles[fromKey], b = profiles[toKey];
  if (!a || !b) return { error: "Unknown recipient" };
  if (fromKey === toKey) return { error: "Cannot gift yourself" };
  if (a.clubId !== b.clubId || !a.clubId) return { error: "Not in same club" };
  const amt = Math.max(1, Math.min(1000, Math.floor(Number(amount) || 0)));
  if (a.coins < amt) return { error: "Not enough coins" };
  a.coins -= amt;
  b.coins += amt;
  flush();
  return { ok: true, amount: amt, senderCoins: a.coins };
}

function listClubs(limit = 30) {
  return Object.values(clubs)
    .map(c => ({ id: c.id, name: c.name, description: c.description, members: c.memberKeys.length }))
    .slice(0, limit);
}
function getClub(clubId) {
  const c = clubs[clubId];
  if (!c) return null;
  return {
    ...c,
    members: c.memberKeys.map(k => {
      const m = profiles[k];
      return m ? { playerKey: k, name: m.displayName, wins: m.wins, xp: m.xp } : null;
    }).filter(Boolean)
  };
}

module.exports = {
  getOrCreate, update, increment,
  sanitizeName,
  todayKey, yesterdayKey, weekKey, rollWeekIfNeeded,
  globalLeaderboard, weeklyLeaderboard,
  createClub, joinClub, leaveClub, postClubChat, giftCoins,
  listClubs, getClub,
  profiles // exposed for server.js (leaderboards)
};
