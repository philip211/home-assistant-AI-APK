// The kitchen: what food is at home, how much, where it lies and until when it is good.
// Bought things move here from the shopping list; things that run out move back to it; what is about to
// spoil is said out loud once a day; "what can I cook" starts from what is here and what spoils first.
"use strict";

let pantry = store.get("pantry", []);   // [{id, name, qty, unit, place: fridge|freezer|shelf, exp: "YYYY-MM-DD"|null, est, min, added}]
const PLACE = { fridge: "холодильник", freezer: "морозилка", shelf: "шкаф" };
const PLACE_IN = { fridge: "в холодильнике", freezer: "в морозилке", shelf: "в шкафу" };
const UNITS = ["шт", "г", "кг", "мл", "л", "уп", "пачка", "бутылка", "банка", "батон", "буханка", "десяток"];

function savePantry() { store.set("pantry", pantry); if (typeof renderPantry === "function") renderPantry(); if (typeof renderWidgets === "function") renderWidgets(); }
// Russian words change their endings ("молоко", "молока", "молоком"): compare the stems
function stem(w) { w = String(w || "").toLowerCase().replace(/ё/g, "е").trim(); return w.length > 4 ? w.slice(0, w.length > 6 ? w.length - 2 : w.length - 1) : w; }
// everyday and recipe names for the same food
const FOOD_SYN = [[/^картошк/, "картофель"], [/^томат/, "помидор"], [/^куриц|^курин|^кур\S* филе/, "курица"], [/^яичк/, "яйца"], [/^лучок/, "лук"], [/^морковк/, "морковь"]];
function canonFood(s) { s = String(s).toLowerCase().replace(/ё/g, "е").trim(); for (const [re, to] of FOOD_SYN) if (re.test(s)) return to + s.replace(/^\S+/, "").replace(/^ /, " "); return s; }
function sameFood(a, b) {
  const x = canonFood(a).split(/\s+/).filter(Boolean), y = canonFood(b).split(/\s+/).filter(Boolean);
  return x.length && y.length && stem(x[0]) === stem(y[0]) && (x.length === 1 || y.length === 1 || stem(x[1]) === stem(y[1]));
}
function pantryFind(name) { return pantry.find(p => sameFood(p.name, name)) || null; }
// where a food goes if nobody says: a guess from the word, good enough for a home
function guessPlace(name) {
  const n = String(name).toLowerCase();
  if (/(заморож|пельмен|вареник|мороженое|наггетс|котлет\S* замор|овощная смесь)/.test(n)) return "freezer";
  if (/(молок|кефир|йогурт|сыр|творог|сметан|сливк|масло слив|сливочн|мяс|кури|фарш|рыб|колбас|сосиск|ветчин|яйц|зелен|салат|огур|помидор|томат|перец|ягод|грибы|соус|майонез|кетчуп|тесто)/.test(n)) return "fridge";
  return "shelf";
}
// "Яйца — 20 шт", "молоко 2 л", "два десятка яиц": the amount and unit, when there is one
function parseAmount(text) {
  const t = String(text);
  let m = /(\d+(?:[.,]\d+)?)\s*(шт|г|гр|кг|мл|л|уп|пач\S*|бут\S*|бан\S*|десят\S*)\.?/i.exec(t);
  if (m) {
    let unit = m[2].toLowerCase(); if (unit === "гр") unit = "г";
    unit = /^пач/.test(unit) ? "пачка" : /^бут/.test(unit) ? "бутылка" : /^бан/.test(unit) ? "банка" : /^десят/.test(unit) ? "десяток" : unit;
    return { qty: +m[1].replace(",", "."), unit, name: t.replace(m[0], "").replace(/[—–-]\s*$/, "").replace(/\s+[—–-]\s+/, " ").trim() };
  }
  return { qty: null, unit: null, name: t.replace(/\s+[—–-]\s*$/, "").trim() };
}

function pantryAdd(spec) {
  const a = parseAmount(spec.name || spec.text || "");
  const name = String(a.name || "").trim().slice(0, 60); if (!name) return null;
  const qty = spec.qty != null && +spec.qty > 0 ? +spec.qty : a.qty, unit = spec.unit || a.unit || null;
  const exp = saneDate(spec.exp) || null, place = PLACE[spec.place] ? spec.place : guessPlace(name);
  const have = pantryFind(name);
  if (have && (have.unit || null) === unit) {   // one more of the same: add up, keep the earliest date to warn about
    if (qty != null) have.qty = (have.qty || 0) + qty;
    if (exp && (!have.exp || exp < have.exp)) { have.exp = exp; have.est = !!spec.est; }
    have.added = today(); delete have.warned;
    savePantry(); return have;
  }
  const p = { id: Math.random().toString(36).slice(2, 8), name: name[0].toUpperCase() + name.slice(1), qty, unit, place, exp, est: !!spec.est,
    min: spec.min != null ? +spec.min : null, added: today() };
  pantry.push(p); savePantry(); return p;
}
// used some or all of it: below its minimum (or gone) it goes on the shopping list
function pantryUse(name, qty) {
  const p = pantryFind(name); if (!p) return { found: false };
  let gone = false;
  if (qty == null || p.qty == null) gone = true;
  else { p.qty = Math.round((p.qty - qty) * 100) / 100; gone = p.qty <= 0; }
  if (gone) pantry = pantry.filter(x => x !== p);
  const low = !gone && p.min != null && p.qty != null && p.qty <= p.min;
  let toShop = false;
  if ((gone && (p.min != null || /^(молок|хлеб|яйц|масл|сахар|соль|чай|кофе|туалетн)/i.test(p.name))) || low) toShop = shopAdd(p.name);
  if (toShop) saveShop();
  savePantry();
  return { found: true, item: p, gone, toShop };
}
function pantryRemove(name) { const p = pantryFind(name); if (!p) return false; pantry = pantry.filter(x => x !== p); savePantry(); return true; }
// bought: from the shopping list into the kitchen
function pantryFromShop(item) {
  if (!item || item.inPantry) return;
  item.inPantry = true;
  if (/(таблет|лекарств|бытов|порош|шампун|мыл|бумаг|салфет|батарейк|лампоч)/i.test(item.text)) return;   // not food
  pantryAdd({ name: item.text });
}

// ---------- dates ----------
function daysLeft(p) { return p.exp ? Math.round((new Date(p.exp + "T12:00") - new Date(today() + "T12:00")) / 864e5) : null; }
function expWords(p) {
  const d = daysLeft(p); if (d == null) return "";
  return d < 0 ? "просрочено" : d === 0 ? "годно до сегодня" : d === 1 ? "до завтра" : d <= 6 ? `ещё ${d} ${plural(d, "день", "дня", "дней")}` : "до " + new Date(p.exp + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
function soonList(days = 2) { return pantry.filter(p => { const d = daysLeft(p); return d != null && d <= days; }).sort((a, b) => daysLeft(a) - daysLeft(b)); }
// "молоко 2 л", "яйца 10 шт", "курица" (one of something needs no number)
function amount(p) {
  if (p.qty == null || (!p.unit && p.qty === 1)) return "";
  return ` ${String(p.qty).replace(".", ",")} ${p.unit || "шт"}`;
}

// once a day, when someone is around and it is a fine moment: what has to be eaten or thrown away
function checkPantry() {
  const h = new Date().getHours();
  if (h < 9 || h > 20 || store.get("pantryNotice", "") === today()) return;
  if (typeof present === "function" && !present(5 * 60000)) return;
  if (typeof mayInterrupt === "function" && !mayInterrupt("reminder")) return;
  if (busy || speaking || fam.guestOnly()) return;
  const soon = soonList(1);
  if (!soon.length) return;
  store.set("pantryNotice", today());
  const bad = soon.filter(p => daysLeft(p) < 0), now_ = soon.filter(p => daysLeft(p) >= 0);
  const say = [now_.length && `Сегодня-завтра нужно съесть: ${listWords(now_.map(p => lowFirst(p.name)))}.`,
    bad.length && `${listWords(bad.map(p => lowFirst(p.name)))} — уже ${bad.length > 1 ? "просрочены" : "просрочено"}, лучше проверить.`].filter(Boolean).join(" ");
  remember("assistant", say); tone(SND.chime); followupUntil = Date.now() + 30000;
  setTimeout(() => speak(say), 600);
}
setInterval(checkPantry, 60000);

// ---------- for the brain ----------
function pantryPrompt() {
  if (!pantry.length) return "Запасы на кухне: не записаны.";
  const rows = [...pantry].sort((a, b) => (daysLeft(a) ?? 999) - (daysLeft(b) ?? 999)).slice(0, 50)
    .map(p => `- ${p.name}${amount(p)} (${PLACE[p.place]}${p.exp ? ", " + expWords(p) + (p.est ? " примерно" : "") : ""}${p.min != null ? ", держать не меньше " + p.min : ""})`);
  return "Запасы на кухне (сначала то, что скоро испортится):\n" + rows.join("\n");
}
function applyPantry(o, fails) {
  let changed = false;
  const list = (x) => Array.isArray(x) ? x : x ? [x] : [];
  for (const s of list(o.pantry_add)) { if (pantryAdd(typeof s === "string" ? { name: s } : s || {})) changed = true; else fails.push("записать продукт"); }
  for (const s of list(o.pantry_use)) {
    const r = pantryUse(typeof s === "string" ? s : s?.name, typeof s === "object" && s?.qty != null ? +s.qty : null);
    if (r.found) changed = true;
  }
  for (const s of list(o.pantry_remove)) if (pantryRemove(typeof s === "string" ? s : s?.name)) changed = true;
  for (const s of list(o.pantry_min)) { const p = pantryFind(s?.name); if (p) { p.min = +s.min || 0; changed = true; savePantry(); } }
  return changed;
}

// ---------- spoken without the AI ----------
const KITCHEN_HAVE = /^(что (у нас )?(есть|осталось|лежит) (в |на )?(холодильник\S*|морозилк\S*|шкаф\S*|кухн\S*|дома|из продуктов|из еды)|что (у нас )?из продуктов|какие (у нас )?продукты)/;
const KITCHEN_SOON = /(что (скоро )?(испортится|пропадает|пропадёт|просроч\S*)|что (надо|нужно) (съесть|доесть) (в первую очередь|сначала|скорее)|какой срок)/;
const KITCHEN_OUT = /^(у нас |у меня )?(закончил(ось|ся|ась|ись)|кончил(ось|ся|ась|ись)|нет больше|не осталось)\s+(.+)$|^(.+?)\s+(закончил(ось|ся|ась|ись)|кончил(ось|ся|ась|ись))$/;
function kitchenLocal(text, low) {
  if (KITCHEN_HAVE.test(low)) {
    const where = /морозил/.test(low) ? "freezer" : /холодил/.test(low) ? "fridge" : /шкаф/.test(low) ? "shelf" : null;
    const items = pantry.filter(p => !where || p.place === where);
    sayLocal(text, items.length
      ? `${where ? PLACE_IN[where][0].toUpperCase() + PLACE_IN[where].slice(1) : "Дома есть"}${where ? " есть" : ""}: ${listWords(items.map(p => lowFirst(p.name) + amount(p)), 10)}.`
      : where ? `${PLACE_IN[where][0].toUpperCase() + PLACE_IN[where].slice(1)} пока ничего не записано. Скажите, что положили, — я запомню.` : "Запасы пока не записаны. Скажите, что купили или что лежит в холодильнике.");
    return true;
  }
  if (KITCHEN_SOON.test(low)) {
    const soon = soonList(3);
    sayLocal(text, soon.length ? `В первую очередь: ${listWords(soon.map(p => lowFirst(p.name) + " — " + expWords(p)))}.` : "Ничего не горит: сроков на ближайшие три дня нет.");
    return true;
  }
  const m = KITCHEN_OUT.exec(low);
  if (m) {
    const what = (m[5] || m[6] || "").replace(/[.!?]+$/, "").trim();
    // "фильм закончился" is not about food: only short names, nothing from the list of things that just end
    if (!what || what.split(/\s+/).length > 3 || /(врем|терпен|сил|деньг|лекарств|таблет|фильм|сериал|урок|пар[аы]|игр|матч|день|работ|встреч|заняти|смен|дожд|снег|праздник|отпуск|музык|песн|батаре|заряд)/.test(what)) return false;
    const r = pantryUse(what, null);
    const added = r.toShop || shopAdd(what[0].toUpperCase() + what.slice(1));
    if (added) saveShop();
    sayLocal(text, `${added ? "Добавила в покупки" : "Уже в покупках"}: ${what}.`.replace("Добавила", g("Добавил", "Добавила")));
    return true;
  }
  return false;
}

// ---------- the "Кухня" tab ----------
function renderPantry() {
  const ul = $("pantry"); if (!ul) return;
  ul.textContent = "";
  const head = (t) => { const li = document.createElement("li"); li.className = "ghead"; li.textContent = t; ul.append(li); };
  for (const place of ["fridge", "freezer", "shelf"]) {
    const items = pantry.filter(p => p.place === place).sort((a, b) => (daysLeft(a) ?? 999) - (daysLeft(b) ?? 999) || a.name.localeCompare(b.name, "ru"));
    if (!items.length) continue;
    head(PLACE[place][0].toUpperCase() + PLACE[place].slice(1));
    for (const p of items) {
      const d = daysLeft(p);
      const li = document.createElement("li");
      li.className = ["food", d != null && d <= 1 && "due", d != null && d < 0 && "spoiled"].filter(Boolean).join(" ");
      li.innerHTML = `<span class="when"></span><span class="txt"><span class="nm"></span><small></small></span><button class="del press" aria-label="Съели или выбросили">${icon("trash")}</button>`;
      li.querySelector(".when").textContent = amount(p).trim();
      li.querySelector(".nm").textContent = p.name;
      li.querySelector("small").textContent = [expWords(p) + (p.est && p.exp ? " (примерно)" : ""), p.min != null && `держать от ${p.min}`].filter(Boolean).join(" · ");
      li.querySelector(".del").onclick = () => { haptic(); li.classList.add("leave"); setTimeout(() => { pantry = pantry.filter(x => x !== p); savePantry(); }, reduceMotion ? 0 : 280); };
      ul.append(li);
    }
  }
  const soon = soonList(1).length;
  $("cntKitchen").textContent = soon ? String(soon) : "";
  renderTab();
}
$("tabKitchen").onclick = () => { haptic(); setTab("kitchen"); renderPantry(); };
renderPantry();
