"use strict";
// ---------- the widget board: weather, glanceable lists, cards that grow over the board, and the idle screen ----------

const EASE = "cubic-bezier(.2, .8, .2, 1)";
const root = document.documentElement;
// the expanded cards cover exactly the board; its box is measured, not guessed
function measureBoard() {
  const r = $("board").getBoundingClientRect();
  root.style.setProperty("--bt", r.top + "px"); root.style.setProperty("--bb", (innerHeight - r.bottom) + "px");
  root.style.setProperty("--bl", r.left + "px"); root.style.setProperty("--br", (innerWidth - r.right) + "px");
}
addEventListener("resize", measureBoard); measureBoard(); setTimeout(measureBoard, 1500);

// FLIP: a layer starts where it was and settles where it now is (transform only — cheap on this tablet)
function flipFrom(el, a, { uniform = false, duration = 520, easing = EASE } = {}) {
  if (reduceMotion || !a || !a.width) return null;
  const b = el.getBoundingClientRect(); if (!b.width) return null;
  const sx = a.width / b.width, sy = uniform ? sx : a.height / b.height;
  return el.animate([{ transformOrigin: "0 0", transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${sx}, ${sy})` },
    { transformOrigin: "0 0", transform: "none" }], { duration, easing });
}
function fadeIn(els, delay = 160, duration = 320) {
  if (reduceMotion) return;
  for (const el of els) el?.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration, delay, easing: EASE, fill: "backwards" });
}

// ---------- look: minimal (light by day, dark after sunset) or the original studio board ----------
const minimal = () => document.body.classList.contains("minimal");
function isDaylight() {
  const n = nowMin(), rise = wx?.sunrise ?? 7 * 60, set = wx?.sunset ?? 19 * 60 + 30;
  return n >= rise + 20 && n < set + 20;   // a little after sunrise, a little after sunset, like the room itself
}
function applyTheme() {
  const on = cfg.theme !== "studio";
  document.body.classList.toggle("minimal", on);
  document.body.classList.toggle("light", on && isDaylight());
  document.body.classList.toggle("campeek", on && cfg.camPeek !== false);   // a small round window of the camera
}
setInterval(applyTheme, 60000);

// ---------- the assistant card grows while it listens, thinks or speaks ----------
let aiFocused = false, collapseT = null;
const FOCUS = new Set(["listening", "thinking", "searching", "speaking", "error"]);
function focusAI(on) {
  if (on === aiFocused) return;
  aiFocused = on;
  if (minimal()) { document.body.classList.toggle("ai-focus", on); return; }   // nothing moves: the rest of the room fades
  const st = $("stage"), bg = st.querySelector(".bg"), core = $("core"), cam = $("camWrap");
  const a = { bg: bg.getBoundingClientRect(), core: core.getBoundingClientRect(), cam: cam.getBoundingClientRect() };
  if (on) measureBoard();
  document.body.classList.toggle("ai-focus", on);
  flipFrom(bg, a.bg, { duration: on ? 560 : 460 });
  flipFrom(core, a.core, { uniform: true, duration: on ? 620 : 480 });
  flipFrom(cam, a.cam, { uniform: true, duration: on ? 560 : 460 });
  fadeIn([st.querySelector(".aiText")], on ? 200 : 120, 360);
}
const _setState = setState;
setState = function (s) {
  _setState(s);
  if (FOCUS.has(s)) { clearTimeout(collapseT); exitAmbient(); focusAI(true); }
  else if (s === "idle") {
    clearTimeout(collapseT);
    // linger a moment so the last words can be read, then step back
    collapseT = setTimeout(() => { if (document.body.dataset.state === "idle" && !speaking && !listeningOnce) focusAI(false); }, 3800);
  }
};
// a tap on the assistant: talk when it is quiet, step back when it is done
let tapWasBusy = false;
$("stage").addEventListener("click", () => { tapWasBusy = speaking || !!ringing; }, true);
$("stage").addEventListener("click", (e) => {
  if (tapWasBusy || e.target.closest("#camWrap")) return;
  if (aiFocused && document.body.dataset.state === "idle") { clearTimeout(collapseT); focusAI(false); return; }
  if (!aiFocused && document.body.dataset.state === "idle") listenOnce(false);
});
$("focusScrim").addEventListener("click", () => { if (!closePanel() && aiFocused && !speaking) focusAI(false); });

// ---------- the lists panel opens out of the widget that was tapped ----------
let panelFrom = null;
const WIDGET_OF = { tasks: "wTasks", shop: "wShop", meds: "wMeds", kitchen: "wKitchen" };
function openPanel(t, from) {
  _setTab(t);
  if (t === "meds" && typeof renderMeds === "function") renderMeds();
  if (t === "kitchen" && typeof renderPantry === "function") renderPantry();
  panelFrom = from || null;
  measureBoard();
  const card = $("tasksCard"), bg = card.querySelector(".bg");
  document.body.classList.add("panel-open");
  if (minimal()) { if (!reduceMotion) card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: EASE }); fadeIn([$("tasks"), $("shop"), $("meds")], 60, 300); return; }
  if (from) flipFrom(bg, from.getBoundingClientRect(), { duration: 520 });
  fadeIn([...card.children].filter(x => !x.classList.contains("bg")), 170, 340);
}
function closePanel() {
  if (!document.body.classList.contains("panel-open")) return false;
  const card = $("tasksCard"), bg = card.querySelector(".bg"), to = panelFrom;
  const done = () => document.body.classList.remove("panel-open");
  if (minimal() && !reduceMotion) { card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE }).onfinish = done; return true; }
  if (reduceMotion || !to) { done(); return true; }
  const a = bg.getBoundingClientRect(), b = to.getBoundingClientRect();
  for (const x of card.children) if (!x.classList.contains("bg")) x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" }).onfinish = function () { this.cancel(); };
  bg.animate([{ transformOrigin: "0 0", transform: "none", opacity: 1 },
    { transformOrigin: "0 0", transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width}, ${b.height / a.height})`, opacity: .4 }],
    { duration: 380, easing: "cubic-bezier(.4, 0, .2, 1)" }).onfinish = done;
  return true;
}
for (const id of ["wTasks", "wShop", "wMeds", "wKitchen"]) {
  const el = $(id);
  el.addEventListener("click", () => { haptic(); openPanel(el.dataset.tab, el); });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); } });
}
$("now").addEventListener("click", (e) => { if (e.target.closest("button")) return; haptic(); openPanel(tab, $(WIDGET_OF[tab]) || $("wTasks")); });
$("panelClose").onclick = () => { haptic(); closePanel(); };
// the brain switching lists while the panel is closed: the widget nods instead
const _setTab = setTab;
setTab = function (t) {
  _setTab(t);
  if (!document.body.classList.contains("panel-open")) bump(WIDGET_OF[t]);
};
function bump(id) { const el = $(id); if (!el) return; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
const _onBack = window.__native.onBack;
window.__native.onBack = () => _onBack() || closePanel() || exitAmbient() || (aiFocused && !speaking ? (focusAI(false), true) : false);

// ---------- weather: Open-Meteo, refreshed every 20 minutes ----------
let wx = store.get("wx", null);
applyTheme();
// the "now" line stays out of sight while it has nothing to say (minimal look)
const NOW_IDLE = ["Напоминаний пока нет", "Всё по плану"];   // nothing due: the line has nothing to say
function nowEmpty() { $("now").classList.toggle("empty", NOW_IDLE.includes($("nowTitle").textContent) && $("timerChip").hidden && $("musicChip").hidden); }
const _renderNow = renderNow;
renderNow = function (...a) { const r = _renderNow.apply(this, a); nowEmpty(); return r; };
setInterval(nowEmpty, 1000); nowEmpty();
function wxIcon(code, day) {
  if (code === 0 || code === 1) return day ? "sun" : "moon";
  if (code === 2) return day ? "partly" : "cloud";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 51) return "rain";
  return "cloud";
}
function setIcon(svg, name) { svg.setAttribute("class", "i wx-" + name + (svg.id === "wxIco" ? " wxIco" : "")); svg.innerHTML = `<use href="#w-${name}"/>`; }
async function wxLoad() {
  if (!cfg.city) { wx = null; renderWx(); return; }
  try {
    const geo = await cityGeo(); if (!geo) return;
    const j = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}`
      + `&current=temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m&hourly=temperature_2m,weather_code,is_day`
      + `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=2&timezone=auto&wind_speed_unit=ms`);
    const c = j.current, i0 = Math.max(0, j.hourly.time.findIndex(t => t > c.time));
    const hours = [];
    for (let k = i0; k < j.hourly.time.length && hours.length < 5; k += 3) hours.push({ h: j.hourly.time[k].slice(11, 13), t: Math.round(j.hourly.temperature_2m[k]), code: j.hourly.weather_code[k], day: j.hourly.is_day[k] });
    wx = { city: geo.name, t: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), code: c.weather_code, day: c.is_day,
      wind: Math.round(c.wind_speed_10m), max: Math.round(j.daily.temperature_2m_max[0]), min: Math.round(j.daily.temperature_2m_min[0]), hours, at: Date.now(),
      sunrise: toMin(j.daily.sunrise?.[0]?.slice(11, 16)), sunset: toMin(j.daily.sunset?.[0]?.slice(11, 16)) };
    store.set("wx", wx); applyTheme();
  } catch {}
  renderWx();
}
const deg = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n) + "°";
function hoursHtml(list) {
  return list.map(h => `<div>${h.h}:00<svg class="i wx-${wxIcon(h.code, h.day)}"><use href="#w-${wxIcon(h.code, h.day)}"/></svg><b>${deg(h.t)}</b></div>`).join("");
}
function renderWx() {
  if (!wx) {
    $("wxCity").textContent = "Погода"; $("wxTemp").textContent = "--°";
    $("wxCond").textContent = cfg.city ? "Загружаю…" : "Укажите город"; $("wxHiLo").textContent = cfg.city ? "" : "в настройках"; $("wxHours").innerHTML = "";
    $("ambWx").hidden = true; $("ambHours").innerHTML = ""; return;
  }
  const icon = wxIcon(wx.code, wx.day), cond = wmo(wx.code);
  $("wxCity").textContent = wx.city; setIcon($("wxIco"), icon);
  $("wxTemp").textContent = deg(wx.t); $("wxCond").textContent = cond;
  $("wxHiLo").textContent = `↑${deg(wx.max)} ↓${deg(wx.min)}`;
  $("wxHours").innerHTML = hoursHtml(wx.hours.slice(0, 5));
  $("ambWx").hidden = false; setIcon($("ambWxIco"), icon);
  $("ambTemp").textContent = deg(wx.t); $("ambCond").textContent = `${cond}, ощущается как ${deg(wx.feels)}`;
  $("ambHiLo").textContent = `↑${deg(wx.max)}  ↓${deg(wx.min)}  ·  ветер ${wx.wind} м/с`;
  $("ambHours").innerHTML = hoursHtml(wx.hours.slice(0, 5));
}
// a tap on the weather: the forecast, read aloud
$("wWx").addEventListener("click", () => { haptic(); if (cfg.city) userSaid("Какая сегодня погода?"); else openSettings(); });
renderWx(); wxLoad(); setInterval(wxLoad, 20 * 60000);

// ---------- glanceable widgets ----------
function li(cls, html) { const x = document.createElement("li"); if (cls) x.className = cls; x.innerHTML = html; return x; }
const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function renderWidgets() {
  const td = today(), n = nowMin();
  // tasks: what is left today, then tomorrow
  const open = tasks.filter(t => !t.done && t.date <= td).sort(byWhen);
  const doneN = tasks.filter(t => t.done && t.date === td).length;
  const ul = $("wTasksList"); ul.textContent = "";
  const room = 7;
  for (const t of open.slice(0, room)) ul.append(li(t.time && toMin(t.time) <= n ? "late" : "", `<span class="t">${t.time || "·"}</span><span class="x">${esc(t.text)}</span>`));
  const tm = tasks.filter(t => !t.done && t.date === addDays(1)).sort(byWhen);
  if (open.length < room && tm.length) ul.append(li("more", `Завтра: ${esc(tm.slice(0, 2).map(t => (t.time ? t.time + " " : "") + t.text).join(", "))}`));
  if (open.length > room) ul.append(li("more", `и ещё ${open.length - room}`));
  $("wTasksCnt").textContent = minimal() ? (open.length ? String(open.length) : "") : open.length || doneN ? `${doneN}/${open.length + doneN}` : "";
  $("wTasksEmpty").hidden = !!ul.children.length;
  // shopping
  const left = shop.filter(s => !s.done);
  const us = $("wShopList"); us.textContent = "";
  for (const s of left.slice(0, 4)) us.append(li("", `<span class="bul"></span><span class="x">${esc(s.text)}</span>`));
  if (left.length > 4) us.append(li("more", `и ещё ${left.length - 4}`));
  $("wShopCnt").textContent = left.length ? String(left.length) : "";
  $("wShopEmpty").hidden = left.length > 0;
  // medicines
  const um = $("wMedsList"); um.textContent = "";
  if (typeof dosesOn === "function") {
    const doses = dosesOn(td);
    const states = doses.map(d => doseState(td, d));
    // the window shows the doses around now: what is due first, then the next ones
    const firstOpen = Math.max(0, states.findIndex(s => s === "due" || s === "missed" || s === "later"));
    for (const [i, d] of doses.entries()) {
      if (i < firstOpen - 1 || um.children.length >= 4) continue;
      um.append(li("st-" + states[i], `<span class="t">${d.time}</span><span class="x">${esc(d.med.name)}</span><i class="dot"></i>`));
    }
    const taken = states.filter(s => s === "taken").length;
    $("wMedsCnt").textContent = minimal() ? (doses.length - taken > 0 ? String(doses.length - taken) : "") : doses.length ? `${taken}/${doses.length}` : "";
    $("wMedsEmpty").hidden = doses.length > 0;
    $("wMedsEmpty").textContent = meds.length ? "Сегодня приёмов нет" : "Не записаны";
  }
  // the kitchen: what spoils soon, otherwise how much is at home
  if (typeof pantry !== "undefined") {
    const soon = soonList(1).length;
    $("wKitchenCnt").textContent = soon ? String(soon) : pantry.length ? String(pantry.length) : "";
    $("wKitchen").classList.toggle("warn", soon > 0);
  }
  // the clock card: the next alarm
  const alarm = tasks.filter(t => t.alarm && !t.done && t.time && (t.date > td || (t.date === td && toMin(t.time) > n))).sort(byWhen)[0];
  $("clockNext").innerHTML = alarm ? `<svg class="i"><use href="#i-bell"/></svg>Будильник ${alarm.date === td ? "" : alarm.date === addDays(1) ? "завтра " : dayLabel(alarm.date).toLowerCase() + " "}${alarm.time}` : "";
}
for (const name of ["renderTasks", "renderShop", "renderMeds", "renderPantry"]) {
  const orig = window[name];
  if (typeof orig !== "function") continue;
  window[name] = function (...a) { const r = orig.apply(this, a); renderWidgets(); return r; };
}
renderWidgets(); setInterval(renderWidgets, 30000);

// ---------- greeting ----------
function renderHello() {
  const who = fam.speakerName();
  $("helloSub").textContent = isQuiet() ? "Тихий режим — отвечаю, только если позовёте"
    : `${who ? who + ", скажите" : "Скажите"} «${cfg.name}» или нажмите на микрофон`;
}
renderHello(); setInterval(renderHello, 15000);

// ---------- the idle screen ----------
let ambientOn = false, lastInteract = Date.now(), shiftT = 0;
const markInteract = () => { lastInteract = Date.now(); };
document.addEventListener("pointerdown", markInteract, true);
function enterAmbient() {
  if (ambientOn) return;
  ambientOn = true; closePanel(); renderAmbient();
  $("ambient").hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add("ambient")));
}
function exitAmbient() {
  if (!ambientOn) return false;
  ambientOn = false; markInteract();
  document.body.classList.remove("ambient");
  setTimeout(() => { if (!ambientOn) $("ambient").hidden = true; }, 500);
  return true;
}
function ambChip(icon, text, acc) { return `<div class="ambChip" style="--acc:${acc}"><svg class="i"><use href="#i-${icon}"/></svg><span>${text}</span></div>`; }
function renderAmbient() {
  const d = new Date(), td = today(), n = nowMin();
  $("ambTime").textContent = hm(d);
  $("ambDate").textContent = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const chips = [];
  const t = timers.slice().sort((a, b) => a.end - b.end)[0];
  if (t) chips.push(ambChip("timer", `${esc(t.label || "Таймер")} <span class="mono">${fmt(Math.max(0, Math.round((t.end - Date.now()) / 1000)))}</span>`, "var(--cyan)"));
  const md = typeof medNow === "function" ? medNow() : null;
  if (md) chips.push(ambChip("pill", esc(md.title) + ` <span class="mono">пора</span>`, "var(--pink)"));
  if (!fam.guestOnly()) {
    const next = tasks.filter(x => !x.done && x.time && x.date === td && toMin(x.time) > n).sort(byWhen)[0];
    if (next) chips.push(ambChip("bell", `<span class="mono">${next.time}</span> ${esc(next.text)}`, "var(--violet)"));
    else {
      const nd = typeof dosesOn === "function" ? dosesOn(td).find(x => doseState(td, x) === "later") : null;
      if (nd) chips.push(ambChip("pill", `<span class="mono">${nd.time}</span> ${esc(nd.med.name)}`, "var(--pink)"));
    }
  }
  if (typeof musicOn === "function" && musicOn()) chips.push(ambChip("sound", esc($("musicText").textContent || "Радио"), "#6ef0c6"));
  const html = chips.join("");
  if ($("ambNext").innerHTML !== html) $("ambNext").innerHTML = html;
  $("ambHint").textContent = `Коснитесь экрана или скажите «${cfg.name}»`;
  $("ambient").classList.toggle("night", inQuietHours());
  // a few pixels of drift every minute keeps the screen from burning in
  if (Date.now() - shiftT > 60000) { shiftT = Date.now(); $("ambIn").style.transform = `translate(${Math.round(Math.random() * 24 - 12)}px, ${Math.round(Math.random() * 24 - 12)}px)`; }
}
$("ambient").addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); exitAmbient(); });
$("wClock").addEventListener("click", () => { haptic(); enterAmbient(); });
setInterval(() => {
  if (ambientOn) { renderAmbient(); return; }
  const min = +cfg.idleMin || 0;
  if (!min || Date.now() - lastInteract < min * 60000) return;
  if (document.body.dataset.state !== "idle" || speaking || ringing || listeningOnce || openSheetEl || aiFocused || onboarding) return;
  enterAmbient();
}, 1000);
// an alarm or a timer brings the board back
const _ring = ring;
ring = function (...a) { exitAmbient(); return _ring.apply(this, a); };
