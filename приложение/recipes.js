// Recipes: real ones found on the internet (1000.menu — a large Russian recipe site whose pages carry
// schema.org markup: ingredients with amounts, servings, time, rating, steps), the best of a few candidates
// opened as a step-by-step card; what is missing at home is checked against the kitchen; amounts scale to
// the number of servings; favourites are kept in a recipe book. When nothing is found the AI writes one.
"use strict";

let cookbook = store.get("cookbook", []);   // saved recipes, the same shape as `recipe`
const RECIPE_SITE = "https://1000.menu";

// ---------- finding ----------
const htmlDoc = (html) => new DOMParser().parseFromString(html, "text/html");
async function recipeCandidates(q) {
  const doc = htmlDoc(await httpGet(`${RECIPE_SITE}/cooking/search?ms=1&str=${encodeURIComponent(q)}`));
  const seen = new Set(), out = [];
  for (const a of doc.querySelectorAll('a[href^="/cooking/"]')) {
    const href = a.getAttribute("href");
    if (!/^\/cooking\/\d+-/.test(href) || seen.has(href)) continue;
    const title = (a.getAttribute("title") || a.textContent || "").replace(/\s+/g, " ").trim();
    if (title.length < 3) continue;
    seen.add(href); out.push({ url: RECIPE_SITE + href, title });
    if (out.length >= 8) break;
  }
  return out;
}
// minutes from "PT1H30M"
function isoMinutes(s) { const m = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(String(s || "")); return m ? (+m[1] || 0) * 60 + (+m[2] || 0) : null; }
// "варите 40 минут", "1,5 часа", "15-20 мин": a timer for the step (the upper end of a range)
function stepTimer(text) {
  const m = /(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(минут|мин\b|час)/i.exec(text);
  if (!m) return 0;
  const n = +(m[2] || m[1]).replace(",", ".");
  return Math.round(/^час/i.test(m[3]) ? n * 3600 : n * 60);
}
async function recipeFromPage(url) {
  const doc = htmlDoc(await httpGet(url));
  const attr = (sel, a = "content") => doc.querySelector(sel)?.getAttribute(a) || "";
  const ingredients = [...doc.querySelectorAll('[itemprop="recipeIngredient"]')].map(e => (e.getAttribute("content") || e.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const steps = [...doc.querySelectorAll('[itemprop="recipeInstructions"] > li')].map(li => {
    const p = li.querySelector(".instruction p") || li.querySelector("p");
    const text = (p?.textContent || li.textContent || "").replace(/\s+/g, " ").trim();
    return { text, timer_sec: stepTimer(text) };
  }).filter(s => s.text.length > 3);
  if (!ingredients.length || !steps.length) return null;
  const title = (doc.querySelector('h1')?.textContent || attr('meta[property="og:title"]') || "Рецепт").replace(/\s+/g, " ").trim();
  return {
    title, steps, ingredients, i: 0, url, source: "1000.menu",
    servings: +attr('[itemprop="recipeYield"]') || null, baseServings: +attr('[itemprop="recipeYield"]') || null,
    minutes: isoMinutes(attr('[itemprop="totalTime"]')), rating: +attr('[itemprop="ratingValue"]') || null, reviews: +attr('[itemprop="reviewCount"]') || 0,
  };
}
// a few candidates read in parallel; the best rated with the most reviews wins, the rest stay for "другой рецепт"
async function recipeSearch(q) {
  const cands = await recipeCandidates(q).catch(() => []);
  if (!cands.length) return null;
  // the dish itself before its relatives: every word of the request, near the start, a short title,
  // and not a variation nobody asked for (a winter preserve, a cold version, a slow cooker)
  const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2).map(w => w.slice(0, 4));
  const fit = (c) => { const t = c.title.toLowerCase(); return words.filter(w => t.includes(w)).length * 3 + (words.length && t.indexOf(words[0]) >= 0 && t.indexOf(words[0]) < 25 ? 2 : 0)
    - (/(на зиму|заправк|заготовк|холодн|мультиварк|в банк|постн|из крапив)/.test(t) && !/(зим|заправ|заготов|холод|мульти|банк|пост|крапив)/.test(q.toLowerCase()) ? 4 : 0) - t.length / 60; };
  cands.sort((a, b) => fit(b) - fit(a));
  const read = await Promise.all(cands.slice(0, 3).map(c => recipeFromPage(c.url).catch(() => null)));
  const good = read.filter(Boolean);
  if (!good.length) return null;
  const score = (r) => (r.rating || 3.5) * Math.log(2 + (r.reviews || 0)) - (r.minutes > 180 ? 1 : 0);
  good.sort((a, b) => score(b) - score(a));
  const best = good[0];
  // "другой" first offers the other recipes already read (best rated first), then the rest of the search
  const readUrls = new Set(good.map(r => r.url));
  best.candidates = [...good.slice(1).map(r => ({ url: r.url, title: r.title, parsed: r })), ...cands.filter(c => !readUrls.has(c.url)).map(c => ({ url: c.url, title: c.title }))];
  best.query = q;
  return best;
}

// ---------- amounts and the kitchen ----------
// "Свинина - 400 гр" → {name: "Свинина", qty: 400, unit: "гр"}; "Соль - по вкусу" → qty null
function splitIngredient(s) {
  const m = /^(.*?)\s+[-–—]\s+(.*)$/.exec(s);
  const name = (m ? m[1] : s).trim(), rest = m ? m[2].trim() : "";
  const q = /^(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(.*)$/.exec(rest);
  return { name, qty: q ? +q[1].replace(",", ".") : null, unit: q ? q[3] : rest, raw: s };
}
function scaledIngredient(s, k) {
  const p = splitIngredient(s);
  if (p.qty == null || k === 1) return s;
  const v = Math.round(p.qty * k * 10) / 10;
  return `${p.name} - ${String(v).replace(".", ",")} ${p.unit}`.trim();
}
// for the voice: "Свинина - 400 гр" → "свинина 400 грамм", "Лук - 1 шт." → "лук 1", "по вкусу" stays
function spokenAmount(s) {
  return s.replace(/\s+[-–—]\s+/, " ").replace(/(\d)\s*гр?\.?(?=\s|$|,)/g, "$1 грамм").replace(/(\d)\s*мл\.?/g, "$1 миллилитров")
    .replace(/(\d)\s*шт\.?/g, "$1").replace(/ст\.\s?л\.?/g, "столовые ложки").replace(/ч(ай)?\.\s?л\.?|чайн\.л\.?/g, "чайные ложки").replace(/\s{2,}/g, " ").trim();
}
const BASIC = /^(соль|перец|вода|сахар|масло растительное|растительное масло|подсолнечное масло|специи|лавровый лист|уксус)/i;
function missingIngredients(r) {
  if (typeof pantryFind !== "function" || typeof pantry === "undefined" || !pantry.length) return [];   // the kitchen is not kept: no guessing
  return (r.ingredients || []).map(splitIngredient).filter(p => !BASIC.test(p.name) && !pantryFind(p.name)).map(p => p.name);
}

// ---------- opening ----------
function openFoundRecipe(r, say = true) {
  recipe = r;
  if (!recipe.servings) recipe.servings = recipe.baseServings;
  openRecipe();
  if (!say) return;
  const bits = [r.title.replace(/[.!]$/, "")];
  if (r.servings) bits.push(`${r.servings} ${plural(r.servings, "порция", "порции", "порций")}`);
  if (r.minutes) bits.push(r.minutes >= 60 ? `${Math.floor(r.minutes / 60)} ч${r.minutes % 60 ? " " + (r.minutes % 60) + " мин" : ""}` : `${r.minutes} мин`);
  const miss = missingIngredients(r);
  const tail = miss.length ? ` Дома не хватает: ${listWords(miss.map(lowFirst), 5)} — добавить в покупки?` : " Ингредиенты на экране, говорите «дальше».";
  const line = bits.join(", ") + "." + tail;
  remember("assistant", line);
  if (miss.length) { recipeAwait = { type: "missing", items: miss, at: Date.now() }; followupUntil = Date.now() + 25000; followExpect = true; }
  speak(line, miss.length ? { then: () => listenOnce(true) } : {});
}
let recipeAwait = null;   // a question the recipe asked: "добавить недостающее в покупки?"

// ---------- the recipe book ----------
function saveToBook(r) {
  if (!r) return false;
  const key = (r.url || r.title).toLowerCase();
  cookbook = cookbook.filter(x => (x.url || x.title).toLowerCase() !== key);
  cookbook.unshift({ ...r, i: 0, candidates: undefined, savedAt: Date.now() });
  cookbook = cookbook.slice(0, 60);
  store.set("cookbook", cookbook);
  return true;
}
function findInBook(q) { const w = q.toLowerCase().split(/\s+/).filter(x => x.length > 2).map(x => x.slice(0, 4)); return cookbook.find(r => w.every(x => r.title.toLowerCase().includes(x))) || null; }

// ---------- voice, without the AI ----------
const RECIPE_FIND = /^(?:(?:найди|покажи|дай|открой|подскажи|нужен|хочу)\s+)?(?:мне\s+)?(?:рецепт|рецептик)\s+(.{3,60})$|^(?:как\s+(?:при)?готовить|давай(?:те)?\s+(?:при)?готовим|научи\s+готовить)\s+(.{3,60})$/;
function recipeLocal(text, low) {
  const now = Date.now();
  // answers to the recipe's own question
  if (recipeAwait && now - recipeAwait.at < 60000) {
    if (/^(да|давай|добавь|ага|конечно|угу)(?=$|[\s,.!?])/.test(low)) {
      const added = recipeAwait.items.map(s => s[0].toUpperCase() + s.slice(1)).filter(shopAdd);
      recipeAwait = null; if (added.length) saveShop();
      sayLocal(text, added.length ? `${g("Добавил", "Добавила")} в покупки: ${listWords(added.map(lowFirst))}.` : "Это уже есть в покупках."); return true;
    }
    if (/^(нет|не надо|не нужно|есть|всё есть)(?=$|[\s,.!?])/.test(low)) { recipeAwait = null; sayLocal(text, "Хорошо. Говорите «дальше», когда начнём."); return true; }
  }
  if (recipe) {
    if (/^(повтори|ещё раз|еще раз|что там|какой шаг)/.test(low)) { speak(recipe.steps[recipe.i]?.text || ""); return true; }
    if (/(какие|что нужно|что надо|список) .*(ингредиент|продукт)|^ингредиенты/.test(low)) {
      const k = recipe.baseServings && recipe.servings ? recipe.servings / recipe.baseServings : 1;
      sayLocal(text, recipe.ingredients?.length ? "Нужно: " + listWords(recipe.ingredients.map(s => lowFirst(spokenAmount(scaledIngredient(s, k)))), 12) + "." : "Ингредиенты в этом рецепте не указаны.");
      return true;
    }
    const sv = /на\s+(\d+|одного|двоих|двух|троих|трёх|четверых|четырёх|пятерых|шестерых)\s*(порц\S*|человек\S*)?$/.exec(low);
    if (sv && recipe.baseServings) {
      const map = { одного: 1, двоих: 2, двух: 2, троих: 3, трёх: 3, четверых: 4, четырёх: 4, пятерых: 5, шестерых: 6 };
      const n = +sv[1] || map[sv[1]]; if (n > 0 && n < 50) { recipe.servings = n; renderRecipe(); sayLocal(text, `Пересчитала на ${n} ${plural(n, "порцию", "порции", "порций")}.`.replace("Пересчитала", g("Пересчитал", "Пересчитала"))); return true; }
    }
    if (/^(другой|другой рецепт|не тот|не этот|покажи другой|следующий рецепт)/.test(low) && recipe.candidates?.length) {
      const next = recipe.candidates.shift(), rest = recipe.candidates;
      if (next.parsed) { const r = { ...next.parsed, i: 0, candidates: rest, query: recipe.query }; openFoundRecipe(r); return true; }
      showSay("Ищу другой…"); setState("searching");
      recipeFromPage(next.url).then(r => { if (r) { r.candidates = rest; r.query = recipe?.query; openFoundRecipe(r); } else sayLocal(text, "Этот не открылся. Скажите «другой» ещё раз."); }, () => sayLocal(text, "Сайт с рецептами не ответил."));
      return true;
    }
    if (/^(сохрани|запомни|добавь в (мои |избранн\S* )?рецепт)/.test(low)) { saveToBook(recipe); sayLocal(text, `Сохранила в ваши рецепты: ${lowFirst(recipe.title)}.`.replace("Сохранила", g("Сохранил", "Сохранила"))); return true; }
    if (/^(добавь|закинь) (недостающ|чего не хватает|ингредиенты) .*покуп/.test(low)) {
      const added = missingIngredients(recipe).map(s => s[0].toUpperCase() + s.slice(1)).filter(shopAdd);
      if (added.length) saveShop();
      sayLocal(text, added.length ? `${g("Добавил", "Добавила")} в покупки: ${listWords(added.map(lowFirst))}.` : "Всё нужное уже есть или в покупках."); return true;
    }
  }
  if (/^(мои рецепты|сохран\S* рецепты|что у меня в рецептах|книга рецептов)/.test(low)) {
    sayLocal(text, cookbook.length ? `Сохранено ${cookbook.length}: ${listWords(cookbook.map(r => lowFirst(r.title)), 6)}. Скажите «открой рецепт …».` : "Сохранённых рецептов пока нет. Откройте рецепт и скажите «сохрани»."); return true;
  }
  const m = RECIPE_FIND.exec(low);
  if (m) {
    const dish = (m[1] || m[2] || "").replace(/[.!?]+$/, "").replace(/^(для|на)\s+\S+\s+/, "").trim();
    if (!dish || /^(из того|что есть|на ужин|на обед|на завтрак)/.test(dish)) return false;   // "из того, что есть" is for the AI and the kitchen
    const saved = findInBook(dish);
    if (saved) { openFoundRecipe({ ...saved }); return true; }
    remember("user", text); setState("searching"); showSay("Ищу рецепт…");
    recipeSearch(dish).then(r => {
      if (r) { showSource("Рецепт · 1000.menu"); openFoundRecipe(r); }
      else ask(text, "user");   // nothing on the site: the AI writes one
    }, () => ask(text, "user"));
    return true;
  }
  return false;
}
