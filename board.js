// ============================================================================
// Ludo Club v5 — board renderer
// Draws the 15x15 Ludo cross on the main canvas, tokens with selected skin,
// and runs a particle FX layer for captures + win confetti.
// ============================================================================

(function () {
  const START_INDEX = { red: 0, green: 13, yellow: 26, blue: 39 };
  const SAFE_INDICES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

  // Board coordinate system: 15x15 grid, cell size = canvas/15.
  // We lay out:
  //   rows 0-5, cols 0-5      → red home base (top-left quadrant inverted)
  //   rows 0-5, cols 9-14     → green home base
  //   rows 9-14, cols 0-5     → blue home base
  //   rows 9-14, cols 9-14    → yellow home base
  //
  //   52-square ring path (index 0 = red start)
  //   Home columns: 6 cells leading from the ring to the center for each color.
  //
  // Ring cell coordinates, index 0..51. Pre-computed so we don't recalc each frame.

  // Ring path (col, row) starting at red start (row 6, col 1), going clockwise.
  const RING = [
    // Red arm (going down-right along row 6)
    [1,6],[2,6],[3,6],[4,6],[5,6],
    // Left column of top arm (col 6 going up)
    [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
    // Top row middle cell to green start
    [7,0],
    // Green: top arm right column going down
    [8,0],[8,1],[8,2],[8,3],[8,4],[8,5],
    // Right arm going right
    [9,6],[10,6],[11,6],[12,6],[13,6],[14,6],
    // Right arm middle
    [14,7],
    // Right arm bottom coming back
    [14,8],[13,8],[12,8],[11,8],[10,8],[9,8],
    // Bottom arm right column going down
    [8,9],[8,10],[8,11],[8,12],[8,13],[8,14],
    // Bottom arm middle
    [7,14],
    // Bottom arm left column coming back up
    [6,14],[6,13],[6,12],[6,11],[6,10],[6,9],
    // Left arm going left
    [5,8],[4,8],[3,8],[2,8],[1,8],[0,8],
    // Left arm middle
    [0,7],
    // Left arm top coming back
    [0,6],[1,6] // WAIT this is wrong — I should not repeat
  ];
  // Actually let's build the ring programmatically so it's correct and
  // cross-check: red start = ring 0 must sit in front of the red home base.
  // Standard Ludo ring (52 cells) for a 15x15 board:
  const RING_PATH = buildRing();

  function buildRing() {
    // Top-down derivation of the 52 ring squares on a 15x15 board.
    // Coordinates in (col, row) where (0,0) is top-left.
    //
    // Red start = (1,6). From there, clockwise.
    const p = [];
    // 1. Red arm horizontal: (1..5, 6)  — 5 squares
    for (let c = 1; c <= 5; c++) p.push([c, 6]);
    // 2. Vertical left side of top arm: (6, 5..0) — 6 squares
    for (let r = 5; r >= 0; r--) p.push([6, r]);
    // 3. Top middle: (7, 0) — 1 square  (green start is here at ring index 13)
    p.push([7, 0]);
    // 4. Vertical right side of top arm: (8, 0..5) — 6 squares
    for (let r = 0; r <= 5; r++) p.push([8, r]);
    // 5. Top of green arm going right: (9..14, 6) — 6 squares
    for (let c = 9; c <= 14; c++) p.push([c, 6]);
    // 6. Right middle: (14, 7) — 1 square (yellow start, ring 26)
    p.push([14, 7]);
    // 7. Bottom of right arm: (14..9, 8) — 6 squares
    for (let c = 14; c >= 9; c--) p.push([c, 8]);
    // 8. Down right side of bottom arm: (8, 9..14) — 6 squares
    for (let r = 9; r <= 14; r++) p.push([8, r]);
    // 9. Bottom middle: (7, 14) — 1 square (blue start, ring 39)
    p.push([7, 14]);
    // 10. Up left side of bottom arm: (6, 14..9) — 6 squares
    for (let r = 14; r >= 9; r--) p.push([6, r]);
    // 11. Left arm going left: (5..0, 8) — 6 squares
    for (let c = 5; c >= 0; c--) p.push([c, 8]);
    // 12. Left middle: (0, 7) — 1 square
    p.push([0, 7]);
    // 13. Up left arm: (0, 6) — 1 square, then continues into red arm start
    p.push([0, 6]);
    // Total so far: 5 + 6 + 1 + 6 + 6 + 1 + 6 + 6 + 1 + 6 + 6 + 1 + 1 = 52 ✓
    return p;
  }

  // Home column paths — 6 cells from ring entry to center.
  const HOME_PATHS = {
    red:    [[1,7],[2,7],[3,7],[4,7],[5,7],[6,7]],
    green:  [[7,1],[7,2],[7,3],[7,4],[7,5],[7,6]],
    yellow: [[13,7],[12,7],[11,7],[10,7],[9,7],[8,7]],
    blue:   [[7,13],[7,12],[7,11],[7,10],[7,9],[7,8]]
  };

  // Base yard coordinates (where the 4 tokens sit when in base).
  const BASE_SLOTS = {
    red:    [[1.5,1.5],[3.5,1.5],[1.5,3.5],[3.5,3.5]],
    green:  [[10.5,1.5],[12.5,1.5],[10.5,3.5],[12.5,3.5]],
    yellow: [[10.5,10.5],[12.5,10.5],[10.5,12.5],[12.5,12.5]],
    blue:   [[1.5,10.5],[3.5,10.5],[1.5,12.5],[3.5,12.5]]
  };

  // Center triangle (home) — we'll draw tokens arriving here in a stack.
  const HOME_CENTER = { red: [6.3,7.5], green: [7.5,6.3], yellow: [8.7,7.5], blue: [7.5,8.7] };

  const COLORS = {
    red:    "#e74c3c",
    green:  "#22c55e",
    yellow: "#f1c40f",
    blue:   "#3498db"
  };
  const COLOR_DARK = {
    red: "#a52519", green: "#15803d", yellow: "#a16207", blue: "#1e40af"
  };

  const TABLE_THEMES = {
    classic: { bg: "#ffffff", inner: "#fbfbfb", safe: "#eef2f5", line: "#c9d1da", ink: "#1a2133" },
    wood:    { bg: "#e8d4b4", inner: "#f4e6ce", safe: "#d4bf96", line: "#8b6b3d", ink: "#3d2816" },
    emerald: { bg: "#d4f0e3", inner: "#e8faf0", safe: "#a9deca", line: "#278f6d", ink: "#0f3d2e" },
    royal:   { bg: "#e5dcff", inner: "#f2ecff", safe: "#c6b6f5", line: "#6b54c6", ink: "#2b1d55" },
    savanna: { bg: "#f7d9a6", inner: "#fde8c4", safe: "#e8bc7a", line: "#c06b26", ink: "#4a2509" },
    kente:   { bg: "#1a1a1a", inner: "#222222", safe: "#2e2e2e", line: "#d4af37", ink: "#f4e3b3" }
  };

  // ==== main render =========================================================
  function render(ctx, W, H, state, me, hoveredTokenId, tableTheme) {
    const theme = TABLE_THEMES[tableTheme] || TABLE_THEMES.classic;
    const cell = W / 15;

    // Background
    ctx.clearRect(0, 0, W, H);
    drawRoundRect(ctx, 0, 0, W, H, 14, theme.bg);

    // Draw quadrant home bases (the big colored squares in each corner)
    drawHomeBase(ctx, 0, 0, 6, 6, COLORS.red, theme);
    drawHomeBase(ctx, 9, 0, 6, 6, COLORS.green, theme);
    drawHomeBase(ctx, 9, 9, 6, 6, COLORS.yellow, theme);
    drawHomeBase(ctx, 0, 9, 6, 6, COLORS.blue, theme);

    // Draw the 15x15 grid on the "cross" cells only
    drawCrossCells(ctx, cell, theme);

    // Draw colored starting arms (6 cells in front of each home base)
    // These sit on the ring, just tinted to the owner color.
    colorizeArmCell(ctx, RING_PATH[0], COLORS.red, theme, cell);        // red start
    colorizeArmCell(ctx, RING_PATH[13], COLORS.green, theme, cell);     // green start
    colorizeArmCell(ctx, RING_PATH[26], COLORS.yellow, theme, cell);    // yellow start
    colorizeArmCell(ctx, RING_PATH[39], COLORS.blue, theme, cell);      // blue start

    // Home column tinting
    for (const color of ["red","green","yellow","blue"]) {
      for (const [c, r] of HOME_PATHS[color]) {
        fillCell(ctx, c, r, cell, tintCell(COLORS[color], theme, 0.35));
        strokeCell(ctx, c, r, cell, theme.line);
      }
    }

    // Star markers on safe squares
    for (let i = 0; i < 52; i++) {
      if (!SAFE_INDICES.has(i)) continue;
      const [c, r] = RING_PATH[i];
      drawStar(ctx, (c + 0.5) * cell, (r + 0.5) * cell, cell * 0.22, theme.ink);
    }

    // Center home triangle (the middle 3x3 area)
    drawCenter(ctx, cell);

    // Highlight legal targets (squares a movable token would land on)
    if (state && state.game && state.game.mustMove && me && me.color === state.game.currentColor) {
      for (const tokenId of (state.game.movableTokenIds || [])) {
        const piece = findPiece(state, tokenId);
        if (!piece) continue;
        const target = pieceTargetCell(piece, state.game.lastRoll);
        if (target) {
          const [tc, tr] = target;
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = "#fff";
          ctx.fillRect(tc * cell, tr * cell, cell, cell);
          ctx.restore();
          drawRing(ctx, (tc + 0.5) * cell, (tr + 0.5) * cell, cell * 0.42, "#fff", 3);
        }
      }
    }

    // Draw tokens
    if (state && state.game) {
      drawAllTokens(ctx, cell, state, me, hoveredTokenId);
    }
  }

  function drawHomeBase(ctx, cx, cy, w, h, color, theme) {
    const cell = ctx.canvas.width / 15;
    // Outer panel
    ctx.fillStyle = color;
    roundRect(ctx, cx*cell, cy*cell, w*cell, h*cell, 8);
    ctx.fill();
    // Inner light recess
    ctx.fillStyle = theme.inner;
    roundRect(ctx, (cx+1)*cell, (cy+1)*cell, (w-2)*cell, (h-2)*cell, 6);
    ctx.fill();
    // Four token slots
    for (let i = 0; i < 4; i++) {
      const c = cx + 1.5 + (i % 2) * 2;
      const r = cy + 1.5 + Math.floor(i/2) * 2;
      drawCircle(ctx, (c+0.5)*cell, (r+0.5)*cell, cell*0.4, color);
      drawCircle(ctx, (c+0.5)*cell, (r+0.5)*cell, cell*0.3, theme.inner);
    }
  }

  function drawCrossCells(ctx, cell, theme) {
    // Horizontal arm (rows 6..8, cols 0..14)
    // Vertical arm (cols 6..8, rows 0..14)
    // Skip cells that are inside the 3x3 center (rows 6..8, cols 6..8)
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1.5;
    for (let c = 0; c < 15; c++) {
      for (let r = 0; r < 15; r++) {
        const inHoriz = (r >= 6 && r <= 8);
        const inVert = (c >= 6 && c <= 8);
        const inCenter = (c >= 6 && c <= 8 && r >= 6 && r <= 8);
        if ((inHoriz || inVert) && !inCenter) {
          fillCell(ctx, c, r, cell, theme.inner);
          strokeCell(ctx, c, r, cell, theme.line);
        }
      }
    }
  }

  function colorizeArmCell(ctx, [c, r], color, theme, cell) {
    fillCell(ctx, c, r, cell, tintCell(color, theme, 0.45));
    strokeCell(ctx, c, r, cell, theme.line);
  }

  function fillCell(ctx, c, r, cell, color) {
    ctx.fillStyle = color;
    ctx.fillRect(c * cell, r * cell, cell, cell);
  }
  function strokeCell(ctx, c, r, cell, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(c * cell + 0.5, r * cell + 0.5, cell - 1, cell - 1);
  }

  function tintCell(color, theme, strength) {
    // mix color with theme.inner at strength
    const a = hexToRgb(color);
    const b = hexToRgb(theme.inner);
    const m = (x, y) => Math.round(x * strength + y * (1 - strength));
    return `rgb(${m(a.r, b.r)}, ${m(a.g, b.g)}, ${m(a.b, b.b)})`;
  }

  function drawCenter(ctx, cell) {
    // The middle 3x3 drawn as a 4-way triangle crest.
    const cx = 7.5 * cell, cy = 7.5 * cell;
    const size = 3 * cell;
    const half = size / 2;
    const tris = [
      { pts: [[cx-half, cy-half],[cx+half, cy-half],[cx, cy]], color: COLORS.green },
      { pts: [[cx+half, cy-half],[cx+half, cy+half],[cx, cy]], color: COLORS.yellow },
      { pts: [[cx+half, cy+half],[cx-half, cy+half],[cx, cy]], color: COLORS.blue },
      { pts: [[cx-half, cy+half],[cx-half, cy-half],[cx, cy]], color: COLORS.red }
    ];
    for (const t of tris) {
      ctx.beginPath();
      ctx.moveTo(t.pts[0][0], t.pts[0][1]);
      ctx.lineTo(t.pts[1][0], t.pts[1][1]);
      ctx.lineTo(t.pts[2][0], t.pts[2][1]);
      ctx.closePath();
      ctx.fillStyle = t.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // Center gold star
    drawStar(ctx, cx, cy, cell * 0.55, "#d4af37", "#fff8dc");
  }

  function drawStar(ctx, cx, cy, r, color, highlight) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * 0.45;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (highlight) {
      ctx.strokeStyle = highlight;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  // ==== token drawing =======================================================
  function drawAllTokens(ctx, cell, state, me, hoveredId) {
    const pieces = state.game.pieces;
    const now = performance.now();
    // Collect tokens per cell for stacking.
    const cellMap = new Map();
    const ALL = [];
    for (const color of Object.keys(pieces)) {
      for (const piece of pieces[color]) {
        const [c, r] = resolveCell(piece);
        const key = `${c.toFixed(2)}_${r.toFixed(2)}`;
        if (!cellMap.has(key)) cellMap.set(key, []);
        cellMap.get(key).push({ piece, c, r });
        ALL.push({ piece, c, r });
      }
    }

    const selectedSkin = (me && state.players.find(p => p.playerKey === me.playerKey)?.cosmetics?.tokenSkin) || "classic";

    for (const { piece, c, r } of ALL) {
      const stackKey = `${c.toFixed(2)}_${r.toFixed(2)}`;
      const stack = cellMap.get(stackKey);
      const stackIdx = stack.findIndex(s => s.piece === piece);
      // Offset stacked tokens slightly so they don't completely overlap.
      const offset = stack.length > 1 ? (stackIdx - (stack.length - 1) / 2) * 0.18 : 0;

      const movable = (state.game.movableTokenIds || []).includes(piece.id);
      const isMine = me && piece.color === me.color;
      const isHovered = hoveredId === piece.id;

      drawToken(ctx,
        (c + 0.5 + offset) * cell,
        (r + 0.5) * cell,
        cell * 0.4,
        piece.color,
        { skin: selectedSkin, movable: movable && isMine, hovered: isHovered, now }
      );
    }
  }

  // Token rendering — gives each skin a unique look.
  function drawToken(ctx, x, y, r, color, opts) {
    const { skin, movable, hovered, now } = opts;
    const pulseScale = movable ? 1 + 0.07 * Math.sin(now / 180) : 1;
    const R = r * pulseScale;

    ctx.save();
    if (movable) {
      // Glow halo
      ctx.shadowColor = "#fff";
      ctx.shadowBlur = 16;
    }

    const base = COLORS[color];
    const dark = COLOR_DARK[color];

    if (skin === "classic") {
      drawCircle(ctx, x, y, R, dark);
      drawCircle(ctx, x, y, R * 0.82, base);
      drawCircle(ctx, x, y - R * 0.22, R * 0.32, "rgba(255,255,255,0.4)");
    } else if (skin === "marble") {
      const grad = ctx.createRadialGradient(x - R*0.3, y - R*0.3, R*0.1, x, y, R);
      grad.addColorStop(0, "#fff");
      grad.addColorStop(0.4, base);
      grad.addColorStop(1, dark);
      drawCircle(ctx, x, y, R, grad);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else if (skin === "neon") {
      drawCircle(ctx, x, y, R, "#000");
      drawCircle(ctx, x, y, R * 0.85, base);
      ctx.shadowColor = base;
      ctx.shadowBlur = 12;
      drawCircle(ctx, x, y, R * 0.55, "#fff");
    } else if (skin === "gold") {
      const grad = ctx.createRadialGradient(x - R*0.3, y - R*0.3, R*0.1, x, y, R);
      grad.addColorStop(0, "#fff4c4");
      grad.addColorStop(0.5, "#f3d06a");
      grad.addColorStop(1, "#a8801c");
      drawCircle(ctx, x, y, R, grad);
      drawCircle(ctx, x, y, R * 0.45, base);
    } else if (skin === "gem") {
      // Faceted gemstone look
      ctx.beginPath();
      const N = 6;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        const px = x + Math.cos(a) * R;
        const py = y + Math.sin(a) * R;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      const grad = ctx.createLinearGradient(x - R, y - R, x + R, y + R);
      grad.addColorStop(0, base);
      grad.addColorStop(0.6, "#fff");
      grad.addColorStop(1, dark);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = dark;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (skin === "ankara") {
      // Layered "fabric" pattern
      drawCircle(ctx, x, y, R, dark);
      drawCircle(ctx, x, y, R * 0.78, base);
      // Concentric pattern
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      for (let k = 0.3; k < 1; k += 0.18) {
        ctx.beginPath();
        ctx.arc(x, y, R * k, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Dot
      drawCircle(ctx, x, y, R * 0.15, "#fff");
    }

    if (hovered && movable) {
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, R * 1.1, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function resolveCell(piece) {
    if (piece.progress < 0) {
      // In base
      return BASE_SLOTS[piece.color][parseInt(piece.id.split("-")[1], 10)];
    }
    if (piece.progress >= 58) {
      return HOME_CENTER[piece.color];
    }
    if (piece.progress >= 52) {
      // Home column, index 52..57 → 0..5
      return HOME_PATHS[piece.color][piece.progress - 52];
    }
    // On ring
    const ringIdx = (START_INDEX[piece.color] + piece.progress) % 52;
    return RING_PATH[ringIdx];
  }

  function pieceTargetCell(piece, roll) {
    if (!roll) return null;
    let dest = piece.progress;
    if (dest === -1) {
      if (roll !== 6) return null;
      dest = 0;
    } else {
      dest = dest + roll;
      if (dest > 58) return null;
    }
    if (dest >= 58) return HOME_CENTER[piece.color];
    if (dest >= 52) return HOME_PATHS[piece.color][dest - 52];
    const ring = (START_INDEX[piece.color] + dest) % 52;
    return RING_PATH[ring];
  }

  function findPiece(state, tokenId) {
    for (const color of Object.keys(state.game.pieces)) {
      const p = state.game.pieces[color].find(x => x.id === tokenId);
      if (p) return p;
    }
    return null;
  }

  // Hit test: which movable tokenId (if any) is under a click?
  function hitTest(ctx, W, state, cx, cy) {
    if (!state || !state.game) return null;
    const cell = W / 15;
    // Test in reverse so stacked tokens give the top one priority.
    const movable = new Set(state.game.movableTokenIds || []);
    for (const color of Object.keys(state.game.pieces)) {
      for (const piece of state.game.pieces[color]) {
        if (!movable.has(piece.id)) continue;
        const [c, r] = resolveCell(piece);
        const x = (c + 0.5) * cell;
        const y = (r + 0.5) * cell;
        const dx = cx - x, dy = cy - y;
        if (dx * dx + dy * dy <= (cell * 0.45) ** 2) return piece.id;
      }
    }
    return null;
  }

  // ==== FX layer ============================================================
  const fxParticles = [];
  function emitCaptureBurst(W, x, y, color) {
    for (let i = 0; i < 18; i++) {
      fxParticles.push({
        x, y,
        vx: (Math.random() - 0.5) * 10,
        vy: (Math.random() - 0.5) * 10 - 2,
        r: 3 + Math.random() * 4,
        life: 1,
        color: color || "#ff6b47",
        gravity: 0.3
      });
    }
  }
  function emitConfetti(W, H) {
    const colors = ["#d4af37", "#ff6b47", "#10b981", "#3498db", "#e74c3c", "#f1c40f"];
    for (let i = 0; i < 140; i++) {
      fxParticles.push({
        x: Math.random() * W,
        y: -20,
        vx: (Math.random() - 0.5) * 4,
        vy: 2 + Math.random() * 4,
        r: 4 + Math.random() * 5,
        life: 2.5,
        color: colors[i % colors.length],
        gravity: 0.18,
        spin: (Math.random() - 0.5) * 0.3,
        angle: Math.random() * Math.PI * 2,
        shape: "rect"
      });
    }
  }
  function stepFx(ctx, W, H, dt) {
    ctx.clearRect(0, 0, W, H);
    for (let i = fxParticles.length - 1; i >= 0; i--) {
      const p = fxParticles[i];
      p.vx *= 0.99;
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= dt;
      if (p.spin) p.angle += p.spin;
      if (p.life <= 0 || p.y > H + 40) { fxParticles.splice(i, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.fillStyle = p.color;
      if (p.shape === "rect") {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillRect(-p.r, -p.r/2, p.r * 2, p.r);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // ==== tiny drawing helpers ===============================================
  function drawRoundRect(ctx, x, y, w, h, r, fill) {
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = fill; ctx.fill();
  }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }
  function drawCircle(ctx, x, y, r, fill) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
  }
  function drawRing(ctx, x, y, r, stroke, lw) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke();
  }
  function hexToRgb(hex) {
    const h = hex.replace("#","");
    const full = h.length === 3 ? h.split("").map(c=>c+c).join("") : h;
    const i = parseInt(full, 16);
    return { r: (i>>16)&255, g: (i>>8)&255, b: i&255 };
  }

  // Expose on window
  window.LudoBoard = {
    render, hitTest, emitCaptureBurst, emitConfetti, stepFx,
    COLORS, TABLE_THEMES, resolveCell, pieceTargetCell
  };
})();
