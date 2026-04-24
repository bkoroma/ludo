// ============================================================================
// Ludo Club v5 — client app
// Socket wiring, state, tab renderers, input handling, dice/chat/shop/clubs.
// ============================================================================

(function () {
  "use strict";

  const socket = io({ reconnection: true, reconnectionDelay: 400 });
  const $ = id => document.getElementById(id);

  // ---- Persistent player key ------------------------------------------------
  function ensurePlayerKey() {
    let key = localStorage.getItem("ludoclub_v5_key");
    if (!key) {
      // Match server validator: /^[a-zA-Z0-9_\-]+$/
      key = "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      localStorage.setItem("ludoclub_v5_key", key);
    }
    return key;
  }

  const me = {
    playerKey: ensurePlayerKey(),
    roomCode: null,
    color: null,
    isHost: false
  };

  // ---- State ---------------------------------------------------------------
  let profile = null;
  let catalog = null;       // server catalog
  let roomState = null;     // current room state from server
  let queueInfo = null;
  let hoveredTokenId = null;
  let lastDiceValue = null;

  // ---- DOM bindings --------------------------------------------------------
  const coinsLabel = $("coinsLabel");
  const nameLabel = $("nameLabel");
  const nameInput = $("nameInput");
  const saveNameBtn = $("saveNameBtn");
  const dailyBtn = $("dailyBtn");

  const statWins = $("statWins");
  const statLosses = $("statLosses");
  const statGames = $("statGames");
  const statCaptures = $("statCaptures");
  const statStreak = $("statStreak");
  const statXp = $("statXp");

  const tableList = $("tableList");
  const createPrivateBtn = $("createPrivateBtn");
  const joinRoomBtn = $("joinRoomBtn");
  const roomInput = $("roomInput");
  const queueCard = $("queueCard");
  const queueInfoEl = $("queueInfo");
  const cancelQueueBtn = $("cancelQueueBtn");

  const boardCanvas = $("board");
  const fxCanvas = $("fx");
  const boardCtx = boardCanvas.getContext("2d");
  const fxCtx = fxCanvas.getContext("2d");

  const turnBanner = $("turnBanner");
  const winBanner = $("winBanner");
  const roomLabel = $("roomLabel");
  const buyInLabel = $("buyInLabel");
  const timerLabel = $("timerLabel");
  const playerList = $("playerList");
  const diceDisplay = $("diceDisplay");
  const rollBtn = $("rollBtn");
  const powerRow = $("powerRow");
  const turnHint = $("turnHint");
  const startBtn = $("startBtn");
  const resetBtn = $("resetBtn");
  const leaveBtn = $("leaveBtn");
  const emojiRow = $("emojiRow");
  const quickChatRow = $("quickChatRow");
  const chatList = $("chatList");

  const coinPacksList = $("coinPacksList");
  const powerUpsList = $("powerUpsList");
  const tableSkinsList = $("tableSkinsList");
  const tokenSkinsList = $("tokenSkinsList");
  const diceSkinsList = $("diceSkinsList");

  const yourClubView = $("yourClubView");
  const createClubCard = $("createClubCard");
  const clubNameInput = $("clubNameInput");
  const clubDescInput = $("clubDescInput");
  const createClubBtn = $("createClubBtn");
  const clubList = $("clubList");

  const weeklyRanks = $("weeklyRanks");
  const globalRanks = $("globalRanks");

  const toast = $("toast");

  // ---- Utilities -----------------------------------------------------------
  function show(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(show._t);
    show._t = setTimeout(() => toast.classList.remove("show"), 2400);
  }
  async function getJSON(url, opts) {
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
    return data;
  }
  function setText(el, v) { if (el) el.textContent = v; }

  // ---- Tabs ----------------------------------------------------------------
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".panel").forEach(p => p.classList.toggle("active", p.dataset.panel === id));
      if (id === "clubs") renderClubs();
      if (id === "leaderboard") renderLeaderboards();
      if (id === "shop") renderShop();
    });
  });

  // ---- Data loading --------------------------------------------------------
  async function loadCatalog() {
    catalog = await getJSON("/api/catalog");
    renderEmojis();
    renderQuickChat();
    renderTables();
    renderShop();
    renderPowerUpButtons();
  }
  async function loadProfile() {
    profile = await getJSON(`/api/profile/${me.playerKey}`);
    renderProfile();
  }
  function renderProfile() {
    if (!profile) return;
    setText(coinsLabel, profile.coins.toLocaleString());
    setText(nameLabel, profile.displayName);
    nameInput.value = profile.displayName;
    setText(statWins, profile.wins);
    setText(statLosses, profile.losses);
    setText(statGames, profile.gamesPlayed);
    setText(statCaptures, profile.capturesTotal || 0);
    setText(statStreak, profile.streak);
    setText(statXp, profile.xp || 0);
    renderPowerUpButtons();
  }

  nameLabel.addEventListener("click", () => {
    const next = prompt("Display name", profile?.displayName || "Player");
    if (next && next.trim()) saveName(next.trim());
  });
  saveNameBtn.addEventListener("click", () => saveName(nameInput.value));

  async function saveName(name) {
    profile = await getJSON(`/api/profile/${me.playerKey}/name`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: (name || "Player").trim().slice(0, 24) })
    });
    renderProfile();
    show("Name saved");
  }

  dailyBtn.addEventListener("click", async () => {
    try {
      const r = await getJSON(`/api/profile/${me.playerKey}/claim-daily`, { method: "POST" });
      profile = r.profile;
      renderProfile();
      show(`Daily bonus: +${r.reward} coins (streak ${r.streak})`);
    } catch (e) { show(e.message); }
  });

  // ---- Lobby: tables -------------------------------------------------------
  function tableBadgeClass(id) {
    if (id.startsWith("practice")) return "practice";
    if (id.startsWith("bronze"))   return "bronze";
    if (id.startsWith("silver"))   return "silver";
    if (id.startsWith("gold"))     return "gold";
    if (id.startsWith("diamond"))  return "diamond";
    return "";
  }
  function renderTables() {
    if (!catalog) return;
    tableList.innerHTML = "";
    for (const t of catalog.tables) {
      const el = document.createElement("div");
      el.className = "table-item " + tableBadgeClass(t.id);
      el.innerHTML = `
        <div class="t-name">${t.name}</div>
        <div class="t-meta">
          <span>${t.kind === "2p" ? "1v1" : "4-Player"}</span>
          <span>•</span>
          <span>${t.buyIn === 0 ? "Free" : `🪙 ${t.buyIn} buy-in`}</span>
          ${t.bot ? '<span>•</span><span>vs Bots</span>' : ""}
        </div>
        <div class="t-actions"></div>
      `;
      const actions = el.querySelector(".t-actions");
      if (t.bot) {
        const btn = document.createElement("button");
        btn.textContent = "Play vs Bots";
        btn.addEventListener("click", () => createPrivateRoom(t.id));
        actions.appendChild(btn);
      } else {
        const btn = document.createElement("button");
        btn.textContent = "Quick Match";
        btn.addEventListener("click", () => joinMatchmaking(t.id));
        actions.appendChild(btn);
        const btn2 = document.createElement("button");
        btn2.textContent = "Create Room";
        btn2.className = "secondary";
        btn2.addEventListener("click", () => createPrivateRoom(t.id));
        actions.appendChild(btn2);
      }
      tableList.appendChild(el);
    }
  }

  createPrivateBtn.addEventListener("click", () => createPrivateRoom("practice"));
  joinRoomBtn.addEventListener("click", () => {
    const code = (roomInput.value || "").trim().toUpperCase();
    if (!code) return show("Enter a code");
    socket.emit("join_room", { playerKey: me.playerKey, name: profile?.displayName, roomCode: code });
  });
  cancelQueueBtn.addEventListener("click", () => {
    socket.emit("cancel_matchmaking", { playerKey: me.playerKey });
    queueCard.hidden = true;
  });

  function createPrivateRoom(tableId) {
    socket.emit("create_room", { playerKey: me.playerKey, name: profile?.displayName, tableId });
    switchTab("game");
  }
  function joinMatchmaking(tableId) {
    socket.emit("join_matchmaking", { playerKey: me.playerKey, name: profile?.displayName, tableId });
    show("Searching for players…");
  }
  function switchTab(id) {
    document.querySelector(`.tab[data-tab="${id}"]`)?.click();
  }

  // ---- Chat rows -----------------------------------------------------------
  function renderEmojis() {
    emojiRow.innerHTML = "";
    for (const em of catalog.emojis) {
      const b = document.createElement("button");
      b.className = "emoji-btn";
      b.textContent = em;
      b.addEventListener("click", () => socket.emit("send_emoji", { emoji: em }));
      emojiRow.appendChild(b);
    }
  }
  function renderQuickChat() {
    quickChatRow.innerHTML = "";
    for (const t of catalog.quickChat) {
      const b = document.createElement("button");
      b.className = "quick-btn";
      b.textContent = t;
      b.addEventListener("click", () => socket.emit("send_quick_chat", { text: t }));
      quickChatRow.appendChild(b);
    }
  }

  // ---- Power-ups -----------------------------------------------------------
  function renderPowerUpButtons() {
    if (!catalog || !profile) return;
    powerRow.innerHTML = "";
    for (const pu of catalog.powerUps) {
      const count = profile.powerUps?.[pu.id] || 0;
      const b = document.createElement("button");
      b.className = "power-btn";
      b.disabled = count <= 0 || !isMyTurn();
      const icon = { lucky_six: "🎯", reroll: "🔄", shield: "🛡️", double_dice: "🎲🎲" }[pu.id] || "✨";
      b.innerHTML = `<span class="pu-icon">${icon}</span><span>${pu.name}</span><span class="pu-count">×${count}</span>`;
      b.title = pu.desc;
      b.addEventListener("click", () => socket.emit("use_powerup", { powerUpId: pu.id }));
      powerRow.appendChild(b);
    }
  }

  function isMyTurn() {
    if (!roomState || !roomState.game || roomState.winner) return false;
    const current = roomState.game.currentColor;
    return me.color === current;
  }

  // ---- Shop ----------------------------------------------------------------
  function renderShop() {
    if (!catalog || !profile) return;

    // Coin packs
    coinPacksList.innerHTML = "";
    for (const p of catalog.coinPacks) {
      const el = document.createElement("div");
      el.className = "shop-item";
      el.innerHTML = `
        <div class="s-preview">🪙</div>
        <div class="s-name">${p.name}</div>
        <div>🪙 ${p.coins.toLocaleString()}</div>
        <div class="s-price">$${p.price_usd.toFixed(2)}</div>
        <button data-pack="${p.id}">Buy</button>
      `;
      el.querySelector("button").addEventListener("click", async () => {
        try {
          profile = await getJSON(`/api/profile/${me.playerKey}/buy-coins`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ packId: p.id })
          });
          renderProfile();
          show(`+${p.coins} coins added (demo)`);
        } catch (e) { show(e.message); }
      });
      coinPacksList.appendChild(el);
    }

    // Power-ups (purchase)
    powerUpsList.innerHTML = "";
    for (const pu of catalog.powerUps) {
      const owned = profile.powerUps?.[pu.id] || 0;
      const el = document.createElement("div");
      el.className = "shop-item";
      const icon = { lucky_six: "🎯", reroll: "🔄", shield: "🛡️", double_dice: "🎲🎲" }[pu.id] || "✨";
      el.innerHTML = `
        <div class="s-preview">${icon}</div>
        <div class="s-name">${pu.name} <span class="muted small">×${owned}</span></div>
        <div class="s-desc">${pu.desc}</div>
        <div class="s-price">🪙 ${pu.price}</div>
        <button>Buy 1</button>
      `;
      el.querySelector("button").addEventListener("click", async () => {
        try {
          profile = await getJSON(`/api/profile/${me.playerKey}/buy-powerup`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: pu.id, qty: 1 })
          });
          renderProfile();
          show(`${pu.name} bought`);
        } catch (e) { show(e.message); }
      });
      powerUpsList.appendChild(el);
    }

    // Cosmetics (table / token / dice)
    renderCosmetics("tableSkin", catalog.tableSkins, profile.tableSkinsOwned, profile.selectedTableSkin, tableSkinsList, tableSkinPreview);
    renderCosmetics("tokenSkin", catalog.tokenSkins, profile.tokenSkinsOwned, profile.selectedTokenSkin, tokenSkinsList, tokenSkinPreview);
    renderCosmetics("diceSkin",  catalog.diceSkins,  profile.diceSkinsOwned,  profile.selectedDiceSkin,  diceSkinsList,  diceSkinPreview);
  }

  function renderCosmetics(category, items, owned, selected, container, previewFn) {
    container.innerHTML = "";
    for (const item of items) {
      const isOwned = owned.includes(item.id);
      const isActive = selected === item.id;
      const el = document.createElement("div");
      el.className = "shop-item" + (isActive ? " active" : "");
      el.innerHTML = `
        <div class="s-preview">${previewFn(item.id)}</div>
        <div class="s-name">${item.name}</div>
        <div class="s-price">${item.price === 0 ? "Free" : `🪙 ${item.price}`}</div>
      `;
      const btn = document.createElement("button");
      if (isActive) {
        btn.textContent = "Selected";
        btn.disabled = true;
        btn.className = "secondary";
      } else if (isOwned) {
        btn.textContent = "Use";
        btn.addEventListener("click", async () => {
          try {
            profile = await getJSON(`/api/profile/${me.playerKey}/select`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category, itemId: item.id })
            });
            renderProfile(); renderShop();
            requestDraw();
            show(`${item.name} selected`);
          } catch (e) { show(e.message); }
        });
      } else {
        btn.textContent = `Buy 🪙${item.price}`;
        btn.addEventListener("click", async () => {
          try {
            profile = await getJSON(`/api/profile/${me.playerKey}/buy`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ category, itemId: item.id })
            });
            renderProfile(); renderShop();
            show(`${item.name} unlocked`);
          } catch (e) { show(e.message); }
        });
      }
      el.appendChild(btn);
      container.appendChild(el);
    }
  }
  function tableSkinPreview(id) {
    const icons = { classic: "⬜", wood: "🪵", emerald: "💚", royal: "💜", savanna: "🌅", kente: "🪙" };
    return icons[id] || "🎨";
  }
  function tokenSkinPreview(id) {
    const icons = { classic: "🔴", marble: "⚪", neon: "💠", gold: "🟡", gem: "💎", ankara: "🎨" };
    return icons[id] || "🎨";
  }
  function diceSkinPreview(id) {
    const icons = { classic: "🎲", ember: "🔥", ocean: "🌊", aurora: "🌈", legendary: "⭐" };
    return icons[id] || "🎲";
  }

  // ---- Clubs ---------------------------------------------------------------
  async function renderClubs() {
    if (!profile) return;
    if (profile.clubId) {
      try {
        const c = await getJSON(`/api/clubs/${profile.clubId}`);
        yourClubView.innerHTML = `
          <h3>${escapeHtml(c.name)}</h3>
          <p class="muted">${escapeHtml(c.description || "")}</p>
          <p><strong>${c.members.length}</strong> members</p>
          <button class="danger" id="leaveClubBtn">Leave Club</button>
        `;
        $("leaveClubBtn").addEventListener("click", leaveClub);
        createClubCard.hidden = true;
      } catch {
        yourClubView.textContent = "Club unavailable.";
      }
    } else {
      yourClubView.innerHTML = "You're not in a club yet. Join one below, or found your own.";
      createClubCard.hidden = false;
    }

    const clubs = await getJSON("/api/clubs");
    clubList.innerHTML = "";
    for (const c of clubs) {
      const el = document.createElement("div");
      el.className = "club-item";
      el.innerHTML = `
        <div>
          <div class="c-name">${escapeHtml(c.name)}</div>
          <div class="c-desc">${escapeHtml(c.description || "")}</div>
          <div class="muted small">${c.members} members</div>
        </div>
      `;
      const btn = document.createElement("button");
      btn.textContent = "Join";
      btn.disabled = !!profile.clubId;
      btn.addEventListener("click", async () => {
        try {
          await getJSON(`/api/clubs/${c.id}/join`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerKey: me.playerKey })
          });
          await loadProfile();
          renderClubs();
          show("Joined club");
        } catch (e) { show(e.message); }
      });
      el.appendChild(btn);
      clubList.appendChild(el);
    }
  }
  async function leaveClub() {
    try {
      await getJSON("/api/clubs/leave", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerKey: me.playerKey })
      });
      await loadProfile();
      renderClubs();
      show("Left club");
    } catch (e) { show(e.message); }
  }
  createClubBtn.addEventListener("click", async () => {
    const name = (clubNameInput.value || "").trim();
    const description = (clubDescInput.value || "").trim();
    if (!name) return show("Enter a club name");
    try {
      await getJSON("/api/clubs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerKey: me.playerKey, name, description })
      });
      clubNameInput.value = ""; clubDescInput.value = "";
      await loadProfile();
      renderClubs();
      show("Club founded!");
    } catch (e) { show(e.message); }
  });

  // ---- Leaderboards --------------------------------------------------------
  async function renderLeaderboards() {
    try {
      const [weekly, global] = await Promise.all([
        getJSON("/api/leaderboard/weekly"),
        getJSON("/api/leaderboard/global")
      ]);
      renderRanks(weeklyRanks, weekly, p => p.weeklyWins + " W");
      renderRanks(globalRanks, global, p => (p.xp || 0) + " XP");
    } catch (e) { show(e.message); }
  }
  function renderRanks(container, items, statFn) {
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = '<div class="muted small">No ranked players yet.</div>';
      return;
    }
    items.forEach((p, idx) => {
      const n = idx + 1;
      const row = document.createElement("div");
      row.className = "rank-row" + (n <= 3 ? ` top-${n}` : "");
      row.innerHTML = `
        <div class="rank-num">${n === 1 ? "🥇" : n === 2 ? "🥈" : n === 3 ? "🥉" : "#" + n}</div>
        <div class="rank-name">${escapeHtml(p.displayName)}</div>
        <div class="rank-stat">${statFn(p)}</div>
      `;
      container.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- Game panel ----------------------------------------------------------
  rollBtn.addEventListener("click", () => {
    if (!isMyTurn()) return show("Not your turn");
    socket.emit("roll_dice");
    animateDice();
  });
  startBtn.addEventListener("click", () => socket.emit("start_game"));
  resetBtn.addEventListener("click", () => socket.emit("reset_game"));
  leaveBtn.addEventListener("click", () => {
    socket.emit("leave_room");
    roomState = null;
    me.roomCode = null;
    me.color = null;
    updateGameUI();
    switchTab("lobby");
  });

  function animateDice() {
    diceDisplay.classList.remove("rolling");
    // Force reflow to restart the animation
    void diceDisplay.offsetWidth;
    diceDisplay.classList.add("rolling");
    // Rolling glyphs
    const faces = ["⚀","⚁","⚂","⚃","⚄","⚅"];
    let t = 0;
    const interval = setInterval(() => {
      diceDisplay.textContent = faces[Math.floor(Math.random() * 6)];
      if (++t > 6) clearInterval(interval);
    }, 80);
  }
  function setDiceFace(n) {
    const faces = { 1:"⚀", 2:"⚁", 3:"⚂", 4:"⚃", 5:"⚄", 6:"⚅" };
    diceDisplay.textContent = faces[n] || "🎲";
  }

  // ---- Board canvas input --------------------------------------------------
  function canvasCoords(e) {
    const rect = boardCanvas.getBoundingClientRect();
    const scaleX = boardCanvas.width / rect.width;
    const scaleY = boardCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    return [x, y];
  }
  boardCanvas.addEventListener("click", (e) => {
    if (!roomState || !roomState.game) return;
    if (!isMyTurn()) return;
    const [x, y] = canvasCoords(e);
    const hit = window.LudoBoard.hitTest(boardCtx, boardCanvas.width, roomState, x, y);
    if (hit) {
      socket.emit("move_token", { tokenId: hit });
    }
  });
  boardCanvas.addEventListener("mousemove", (e) => {
    if (!roomState || !roomState.game) return;
    const [x, y] = canvasCoords(e);
    const hit = window.LudoBoard.hitTest(boardCtx, boardCanvas.width, roomState, x, y);
    if (hit !== hoveredTokenId) {
      hoveredTokenId = hit;
      boardCanvas.style.cursor = hit ? "pointer" : "default";
      requestDraw();
    }
  });
  boardCanvas.addEventListener("mouseleave", () => {
    if (hoveredTokenId) { hoveredTokenId = null; requestDraw(); }
  });
  // Touch support — a tap acts as a click on a movable token.
  boardCanvas.addEventListener("touchend", (e) => {
    if (!roomState || !roomState.game || !isMyTurn()) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const rect = boardCanvas.getBoundingClientRect();
    const scaleX = boardCanvas.width / rect.width;
    const scaleY = boardCanvas.height / rect.height;
    const x = (t.clientX - rect.left) * scaleX;
    const y = (t.clientY - rect.top) * scaleY;
    const hit = window.LudoBoard.hitTest(boardCtx, boardCanvas.width, roomState, x, y);
    if (hit) {
      e.preventDefault();
      socket.emit("move_token", { tokenId: hit });
    }
  }, { passive: false });

  // ---- Main render loop ----------------------------------------------------
  let drawDirty = true;
  let lastFxTs = performance.now();
  function requestDraw() { drawDirty = true; }
  function loop(ts) {
    if (drawDirty) {
      const W = boardCanvas.width, H = boardCanvas.height;
      const tableSkin = getMyCosmetic("tableSkin") || "classic";
      window.LudoBoard.render(boardCtx, W, H, roomState, me, hoveredTokenId, tableSkin);
      drawDirty = false;
    }
    // Always step FX and also re-draw board each frame if any movable
    // tokens exist (for pulse animation) or FX are active.
    const hasMovable = roomState?.game?.mustMove && isMyTurn();
    if (hasMovable) drawDirty = true;
    const dt = Math.min(0.05, (ts - lastFxTs) / 1000);
    lastFxTs = ts;
    window.LudoBoard.stepFx(fxCtx, fxCanvas.width, fxCanvas.height, dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  function getMyCosmetic(kind) {
    if (!roomState || !me.color) return (profile ? profile["selected" + kind.charAt(0).toUpperCase() + kind.slice(1)] : null);
    const self = roomState.players.find(p => p.playerKey === me.playerKey);
    if (!self || !self.cosmetics) return null;
    if (kind === "tableSkin") return self.cosmetics.tableSkin;
    if (kind === "tokenSkin") return self.cosmetics.tokenSkin;
    if (kind === "diceSkin")  return self.cosmetics.diceSkin;
    return null;
  }

  // ---- Game UI sync --------------------------------------------------------
  let turnTimerHandle = null;
  function updateGameUI() {
    if (!roomState) {
      setText(roomLabel, "-");
      setText(buyInLabel, "-");
      setText(timerLabel, "-");
      setText(turnBanner, "Waiting…");
      winBanner.hidden = true;
      playerList.innerHTML = "";
      rollBtn.disabled = true;
      startBtn.disabled = true;
      chatList.innerHTML = "";
      return;
    }

    setText(roomLabel, roomState.code);
    setText(buyInLabel, roomState.buyIn ? `🪙 ${roomState.buyIn}` : "Free");

    // Banner
    if (roomState.winner) {
      turnBanner.textContent = `${capitalize(roomState.winner)} wins!`;
      winBanner.hidden = false;
      const self = roomState.players.find(p => p.playerKey === me.playerKey);
      const won = self && self.color === roomState.winner;
      winBanner.textContent = won ? "🏆 You win!" : `${capitalize(roomState.winner)} wins`;
    } else if (roomState.started && roomState.game) {
      const current = roomState.game.currentColor;
      const currentPlayer = roomState.players.find(p => p.color === current);
      const isMe = currentPlayer && currentPlayer.playerKey === me.playerKey;
      turnBanner.textContent = isMe
        ? (roomState.game.mustMove ? "Your move — pick a token" : "Your turn — roll!")
        : `${currentPlayer?.name || capitalize(current)}'s turn`;
      winBanner.hidden = true;
    } else {
      turnBanner.textContent = roomState.players.length >= 2 ? "Ready to start" : "Waiting for players…";
      winBanner.hidden = true;
    }

    // Players
    playerList.innerHTML = "";
    for (const p of roomState.players) {
      const isCurrent = roomState.game && roomState.game.currentColor === p.color;
      const el = document.createElement("div");
      el.className = "player-pill" + (isCurrent ? " active" : "");
      el.innerHTML = `
        <span><span class="dot ${p.color}"></span>${escapeHtml(p.name)}${p.isBot ? '<span class="bot-tag">BOT</span>' : ""}</span>
        <span class="muted small">🪙 ${p.coins || 0}</span>
      `;
      playerList.appendChild(el);
    }

    // Buttons
    const host = roomState.players[0]?.playerKey === me.playerKey;
    startBtn.disabled = roomState.started || !host || roomState.players.length < 2;
    startBtn.textContent = host ? "Start" : "Wait for host";
    resetBtn.disabled = !host || !roomState.game;
    rollBtn.disabled = !isMyTurn() || roomState.game?.mustMove;
    rollBtn.textContent = roomState.game?.mustMove ? "Pick a token" : (isMyTurn() ? "Roll Dice" : "Opponent's turn");

    // Dice
    if (roomState.game?.lastRoll) {
      if (lastDiceValue !== roomState.game.lastRoll) {
        setTimeout(() => setDiceFace(roomState.game.lastRoll), 600);
      } else {
        setDiceFace(roomState.game.lastRoll);
      }
      lastDiceValue = roomState.game.lastRoll;
    } else if (!roomState.started) {
      diceDisplay.textContent = "🎲";
      lastDiceValue = null;
    }

    // Hint
    if (roomState.game?.mustMove && isMyTurn()) {
      turnHint.textContent = `You rolled ${roomState.game.lastRoll}. Tap a highlighted token.`;
    } else if (isMyTurn() && !roomState.game?.mustMove) {
      turnHint.textContent = "Roll the dice to begin your turn.";
    } else if (roomState.started && roomState.game) {
      turnHint.textContent = `Waiting on ${capitalize(roomState.game.currentColor)}.`;
    } else {
      turnHint.textContent = "—";
    }

    // Chat
    chatList.innerHTML = "";
    for (const c of roomState.chat || []) {
      const el = document.createElement("div");
      el.className = "chat-item" + (c.system ? " sys" : "");
      if (c.system) {
        el.textContent = c.text;
      } else {
        const content = c.emoji || escapeHtml(c.text || "");
        el.innerHTML = `<strong style="color:${colorHex(c.color)}">${escapeHtml(c.from)}:</strong> ${content}`;
      }
      chatList.appendChild(el);
    }
    chatList.scrollTop = chatList.scrollHeight;

    // Turn timer countdown
    if (turnTimerHandle) { clearInterval(turnTimerHandle); turnTimerHandle = null; }
    if (roomState.turnEndsAt) {
      const tick = () => {
        const sec = Math.max(0, Math.round((roomState.turnEndsAt - Date.now()) / 1000));
        setText(timerLabel, `${sec}s`);
      };
      tick();
      turnTimerHandle = setInterval(tick, 250);
    } else {
      setText(timerLabel, "-");
    }

    renderPowerUpButtons();
    requestDraw();
  }
  function colorHex(c) {
    return { red:"#e74c3c", green:"#22c55e", yellow:"#f1c40f", blue:"#3498db" }[c] || "#fff";
  }
  function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ""; }

  // ---- Capture / win detection for FX -------------------------------------
  let prevPieces = null;
  function detectFx(prev, next) {
    if (!prev || !next?.game?.pieces) return;
    // Any piece that went from non-base to base = capture burst at its old spot
    for (const color of Object.keys(next.game.pieces)) {
      const prevList = prev.pieces?.[color] || [];
      const nextList = next.game.pieces[color];
      for (let i = 0; i < nextList.length; i++) {
        const before = prevList[i];
        const after = nextList[i];
        if (before && after && before.progress > -1 && after.progress === -1) {
          // Captured! Burst at its old location.
          const old = window.LudoBoard.resolveCell(before);
          if (old) {
            const cell = boardCanvas.width / 15;
            window.LudoBoard.emitCaptureBurst(
              boardCanvas.width,
              (old[0] + 0.5) * cell,
              (old[1] + 0.5) * cell,
              colorHex(color)
            );
          }
        }
      }
    }
  }

  // ---- Socket events -------------------------------------------------------
  socket.on("connect", () => {
    socket.emit("hello", { playerKey: me.playerKey, name: profile?.displayName });
    socket.emit("reconnect_session", { playerKey: me.playerKey });
  });
  socket.on("hello_ok", () => {});
  socket.on("room_joined", ({ roomCode, color, host, matched }) => {
    me.roomCode = roomCode;
    me.color = color;
    me.isHost = !!host;
    queueCard.hidden = true;
    if (matched) show("Matched!");
    switchTab("game");
  });
  socket.on("session_info", (info) => {
    if (info.inRoom) {
      me.roomCode = info.roomCode;
      me.color = info.color;
      me.isHost = !!info.host;
      switchTab("game");
    }
  });
  socket.on("queue_status", (info) => {
    if (info.queued) {
      queueCard.hidden = false;
      setText(queueInfoEl, `Waiting for players… (${info.size}/${info.need || "?"})`);
    } else {
      queueCard.hidden = true;
    }
  });
  socket.on("state", (s) => {
    const prevGame = roomState?.game;
    const prevWinner = roomState?.winner || null;
    roomState = s;
    // Detect captures against prevGame
    detectFx(prevGame, s);
    // Fire confetti once per win transition
    if (s.winner && !prevWinner) {
      window.LudoBoard.emitConfetti(fxCanvas.width, fxCanvas.height);
    }
    // Refresh profile on settle so coin/xp changes show
    if (s.winner && !prevWinner) loadProfile();
    updateGameUI();
  });
  socket.on("error_message", (msg) => show(msg));

  // ---- Canvas high-DPI handling --------------------------------------------
  function sizeCanvas(c) {
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Internal resolution
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
  }
  function resize() {
    sizeCanvas(boardCanvas);
    sizeCanvas(fxCanvas);
    requestDraw();
  }
  window.addEventListener("resize", resize);

  // ---- Bootstrap -----------------------------------------------------------
  (async function bootstrap() {
    try {
      await Promise.all([loadCatalog(), loadProfile()]);
      resize();
      updateGameUI();
    } catch (e) {
      show("Failed to load: " + e.message);
    }
  })();

})();
