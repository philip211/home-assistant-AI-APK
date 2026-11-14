"use strict";
// The AI core: luminous currents inside a glass sphere and an equalizer ring around it.
// Reads the assistant state from <body data-state>, and the live voice level from window.coreLevel when set.
(() => {
  const cv = document.getElementById("coreCanvas");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
  const R = W * 0.25;
  const BARS = 72;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PALETTE = {
    idle: ["#49d8ff", "#9b6bff", "#ff5fcf", "#ffb36b"],
    listening: ["#49d8ff", "#6ef0c6", "#3a8bff", "#9be7ff"],
    thinking: ["#8e9bff", "#9b6bff", "#49d8ff", "#c38bff"],
    speaking: ["#ff5fcf", "#9b6bff", "#ffb36b", "#49d8ff"],
    error: ["#ff5d6c", "#ffb547", "#ff5fcf", "#ff8a6c"],
  };
  const PARAMS = {   // swirl speed, inner energy, ring activity
    idle: { speed: 0.25, level: 0.1, ring: 0.12 },
    listening: { speed: 0.7, level: 0.45, ring: 0.6 },
    thinking: { speed: 1.7, level: 0.3, ring: 0.3 },
    speaking: { speed: 0.9, level: 0.55, ring: 0.85 },
    error: { speed: 0.3, level: 0.15, ring: 0.1 },
  };
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const css = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
  let cur = PALETTE.idle.map(rgb), level = 0, ring = 0, speed = 0.25, t = 0, last = 0;
  const heights = new Float32Array(BARS).fill(4);
  window.coreLevel = null;

  function stateKey() {
    const s = document.body.dataset.state || "idle";
    if (s === "looking" || s === "searching") return "thinking";
    return PARAMS[s] ? s : "idle";
  }

  function frame(now) {
    requestAnimationFrame(frame);
    // ~24 fps while active, ~12 fps for the slow idle breathing: each frame costs a recomposite on this tablet
    const idle = (document.body.dataset.state || "idle") === "idle";
    if (document.hidden || document.body.classList.contains("ambient") || document.body.classList.contains("minimal") || now - last < (idle ? 83 : 41)) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const key = stateKey(), p = PARAMS[key], target = PALETTE[key].map(rgb);
    const k = Math.min(1, dt * 3);
    cur = cur.map((c, i) => c.map((v, j) => v + (target[i][j] - v) * k));
    speed += (p.speed - speed) * Math.min(1, dt * 2);
    t += dt * speed * (reduce ? 0.2 : 1);
    let live = p.level;
    if (key === "speaking" && typeof window.coreLevel === "function") live = Math.max(0.12, Math.min(1, window.coreLevel() * 2.4));
    else if (key === "speaking" || key === "listening") live = p.level * (0.55 + 0.45 * Math.abs(Math.sin(t * 5.3) * Math.sin(t * 2.1 + 1)));
    level += (live - level) * Math.min(1, dt * 10);
    ring += (p.ring - ring) * Math.min(1, dt * 3);
    draw(key);
  }

  function draw(key) {
    ctx.clearRect(0, 0, W, H);
    const r = R * (1 + Math.sin(t * 1.6) * 0.02 + level * 0.07);

    // halo
    const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.95);
    halo.addColorStop(0, css(cur[0], 0.2 + level * 0.25));
    halo.addColorStop(0.6, css(cur[1], 0.06 + level * 0.08));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, r * 1.95, 0, Math.PI * 2); ctx.fill();

    // sphere: four currents of light orbiting inside
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#0a0c17"; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const ang = t * (0.6 + i * 0.23) + i * Math.PI / 2;
      const orbit = r * (0.34 + 0.12 * Math.sin(t * 0.9 + i));
      const x = cx + Math.cos(ang) * orbit, y = cy + Math.sin(ang * 1.1) * orbit;
      const br = r * (0.78 + 0.14 * Math.sin(t * 1.3 + i * 2) + level * 0.25);
      const g = ctx.createRadialGradient(x, y, 0, x, y, br);
      g.addColorStop(0, css(cur[i], 0.85)); g.addColorStop(1, css(cur[i], 0));
      ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.globalCompositeOperation = "source-over";
    // glass: specular highlight and a darker rim for depth
    const hl = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.45, 0, cx - r * 0.35, cy - r * 0.45, r * 0.75);
    hl.addColorStop(0, "rgba(255,255,255,0.5)"); hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    const rim = ctx.createRadialGradient(cx, cy, r * 0.72, cx, cy, r);
    rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, "rgba(4,5,12,0.6)");
    ctx.fillStyle = rim; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.16)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

    // equalizer ring
    const inner = r * 1.2;
    ctx.lineCap = "round"; ctx.lineWidth = 2.6;
    for (let i = 0; i < BARS; i++) {
      const a = i / BARS * Math.PI * 2 - Math.PI / 2;
      const n = 0.5 + 0.5 * Math.sin(i * 0.7 + t * 6.1) * Math.sin(i * 0.23 - t * 3.7);
      heights[i] += (3 + ring * (7 + level * 34 * n) - heights[i]) * 0.35;
      ctx.strokeStyle = css(cur[i % 4], 0.22 + ring * 0.6);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * (inner + heights[i]), cy + Math.sin(a) * (inner + heights[i]));
      ctx.stroke();
    }

    // thinking: three sparks orbiting the core
    if (key === "thinking") {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      for (let s = 0; s < 3; s++) {
        const a = t * 2.4 + s * 2.094;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 1.45, cy + Math.sin(a) * r * 1.45, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  requestAnimationFrame(frame);
})();
