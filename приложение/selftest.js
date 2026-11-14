// Self-check: «Помощник, проверь себя». Every skill is run through its real code with test data, silently
// (the voice, sounds, vibration and pop-ups are switched off for the duration), then everything the household
// had — tasks, lists, kitchen, recipes, medicines, the conversation — is put back exactly as it was.
// The result: a short spoken summary and a list on screen. It also runs by itself after every update.
"use strict";

let selfTesting = false;
const ST_DAY = () => addDays(1);

async function selfTest({ quiet = false } = {}) {
  if (selfTesting) return null;
  selfTesting = true;
  const started = performance.now();
  const results = [];
  const heardSay = [];
  // ---------- what must survive the test ----------
  const ls = {}; for (let k = 0; k < localStorage.length; k++) { const key = localStorage.key(k); if (key.startsWith("hp.")) ls[key] = localStorage.getItem(key); }
  const mem = JSON.stringify({ tasks, shop, pantry: typeof pantry !== "undefined" ? pantry : [], cookbook: typeof cookbook !== "undefined" ? cookbook : [],
    meds: typeof meds !== "undefined" ? meds : [], medLog: typeof medLog !== "undefined" ? medLog : {}, timers, dialog, facts, recipe, draft: typeof draft !== "undefined" ? draft : null });
  const keepVars = { lastTaskId, lastReminder, moreText, followupUntil, captureNext, earMode, heardCarry, privateShow };
  // ---------- silence ----------
  const real = {}; const stub = (name, fn) => { real[name] = window[name]; window[name] = fn; };
  stub("speak", (t, o) => { heardSay.push(String(t)); if (o?.then) setTimeout(o.then, 0); });
  stub("remember", () => {}); stub("toast", () => {}); stub("tone", () => {}); stub("haptic", () => {});
  stub("listenOnce", () => {}); stub("openSheet", () => {}); stub("closeSheet", () => {}); stub("showSource", () => {});
  stub("ask", (t, k) => { heardSay.push("[ИИ] " + t); return Promise.resolve(false); });   // local checks must not reach the AI
  let answers = [];
  stub("askUser", () => new Promise(r => setTimeout(() => r(answers.shift() ?? ""), 20)));
  const realPolish = typeof polishRecipe === "function" ? polishRecipe : null;
  if (realPolish) window.polishRecipe = async () => null;
  const realGuest = fam.guestOnly;
  const wasOnboarding = onboarding; onboarding = true;

  const said = async (phrase, wait = 2500) => { const n = heardSay.length; userSaid(phrase); const t = Date.now(); while (heardSay.length === n && Date.now() - t < wait) await new Promise(r => setTimeout(r, 40)); return heardSay.slice(n).join(" "); };
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };
  const until = async (f, ms = 8000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await new Promise(r => setTimeout(r, 50)); return f(); };
  async function check(group, name, fn, { warnOnly = false } = {}) {
    const t = performance.now();
    try { const note = await fn(); results.push({ group, name, level: "ok", note: typeof note === "string" ? note : "", ms: Math.round(performance.now() - t) }); }
    catch (e) { results.push({ group, name, level: warnOnly ? "warn" : "fail", note: e.message || String(e), ms: Math.round(performance.now() - t) }); }
  }

  try {
    // ---------- skills without the AI ----------
    await check("Навыки", "Время", async () => { const r = await said("который час"); need(r.includes(hm().slice(0, 2)), "не назвала время: " + r); });
    await check("Навыки", "Таймер", async () => {
      const n = timers.length; await said("поставь таймер на 5 минут"); need(timers.length === n + 1, "таймер не поставился");
      await said("отмени таймер"); need(timers.length === 0, "таймер не отменился");
    });
    await check("Навыки", "Напоминание", async () => {
      await said("напомни завтра в 9 позвонить маме");
      const t = tasks.find(x => /позвонить маме/i.test(x.text) && x.date === ST_DAY());
      need(t && t.time === "09:00", "не записалось на завтра в 9:00");
    });
    await check("Навыки", "Будильник", async () => { await said("разбуди меня в 7"); need(tasks.some(x => x.alarm && x.time === "07:00"), "будильник не поставлен"); });
    await check("Навыки", "Дела на завтра", async () => { const r = await said("какие дела на завтра"); need(/позвонить маме/i.test(r), "не прочитала дела: " + r); });
    await check("Навыки", "Покупки", async () => {
      await said("надо купить тестовый хлеб"); need(shop.some(s => /тестовый хлеб/i.test(s.text)), "не добавила в покупки");
      const r = await said("что надо купить"); need(/тестовый хлеб/i.test(r), "не прочитала список");
    });
    await check("Навыки", "Пауза посреди фразы", async () => {
      earMode = "once"; heard("напомни завтра в", "once"); need(heardCarry === "напомни завтра в", "не стала ждать продолжения");
      earMode = "once"; heard("10 купить батарейки", "once");
      need(tasks.some(x => /купить батарейки/i.test(x.text) && x.time === "10:00"), "половинки фразы не склеились");
    });
    await check("Навыки", "«Не сейчас» на напоминание", async () => {
      const t = tasks.find(x => /позвонить маме/i.test(x.text)); lastReminder = { id: t.id, at: Date.now() };
      await said("не сейчас"); need(t.date === today() || t.date === ST_DAY(), "не перенесла"); need((t.moved | 0) >= 1, "перенос не засчитан");
    });
    await check("Навыки", "Короткие ответы", async () => {
      const n = heardSay.length;
      // longer than the 240 characters at which a spoken answer is cut
      await apply({ addressed: true, speak: "Первая фраза достаточно длинная, чтобы как следует проверить сокращение ответа вслух. Вторая фраза тоже совсем не короткая и добавляет немало подробностей к первой. Третья фраза уже лишняя для голоса и должна уйти в подробности по запросу. Четвёртая фраза тоже остаётся на потом." }, "user", "тест");
      need(/Рассказать подробнее\?$/.test(heardSay[n] || ""), "длинный ответ не сократился");
      const r = await said("подробнее"); need(/Третья фраза/.test(r), "подробности не прозвучали");
    });
    await check("Навыки", "Гость не может удалять", async () => {
      fam.guestOnly = () => true; const t = tasks[tasks.length - 1];
      await apply({ addressed: true, speak: "Удалила.", tasks_delete: [t.id] }, "user", "удали");
      fam.guestOnly = realGuest; need(tasks.some(x => x.id === t.id), "гость смог удалить дело");
    });
    await check("Навыки", "Имя «Помощник» в запасном варианте", async () => {
      const n = heardSay.length; stopAmbient(); earMode = "ambient";
      window.__native.onAlts("мощник который час|0.6\nпомощник который час|0.3"); window.__native.onFinal("мощник который час");
      await until(() => heardSay.length > n, 2000); need((heardSay[n] || "").includes(hm().slice(0, 2)), "не откликнулась на имя из второго варианта");
    });

    await check("Кухня", "Запасы", async () => {
      pantryAdd({ name: "Тестовое молоко 1 л", place: "fridge", exp: ST_DAY(), est: true });
      const r = await said("что есть в холодильнике"); need(/тестовое молоко/i.test(r), "не перечислила холодильник");
      const s = await said("что скоро испортится"); need(/тестовое молоко/i.test(s), "не назвала скоропортящееся");
    });
    await check("Кухня", "Закончилось → в покупки", async () => {
      await said("закончилось тестовое молоко");
      need(!pantryFind("Тестовое молоко"), "не убрала из запасов"); need(shop.some(s => /тестовое молоко/i.test(s.text)), "не добавила в покупки");
    });
    await check("Кухня", "Купленное → в запасы", async () => {
      shopAdd("Тестовый сыр — 300 г"); const it = shop.find(s => /тестовый сыр/i.test(s.text)); it.done = true; pantryFromShop(it);
      const p = pantryFind("Тестовый сыр"); need(p && p.qty === 300 && p.place === "fridge", "сыр не попал в холодильник с количеством");
    });

    if (typeof addMed === "function") await check("Лекарства", "Расписание", async () => {
      addMed({ name: "Тестовит", times: ["08:00"], repeat: "daily" }, true);
      need(medsPrompt().includes("Тестовит"), "лекарство не записалось");
    });

    if (typeof dictateRecipe === "function") await check("Рецепты", "Диктовка своего рецепта", async () => {
      answers = ["Тестовые сырники", "400 грамм творога, 2 яйца", "убери последнее", "2 яйца", "всё", "смешайте всё", "обжарьте по 3 минуты", "всё", "4", "да"];
      dictateRecipe(false); await until(() => !dictating, 10000);
      const r = cookbook.find(x => x.title === "Тестовые сырники");
      need(r, "рецепт не сохранился"); need(r.ingredients.length === 2 && r.steps.length === 2, `записалось ${r.ingredients.length} ингр. и ${r.steps.length} шагов вместо 2 и 2`);
      need(r.steps[1].timer_sec === 180, "таймер шага не распознан"); need(r.servings === 4, "порции не записались");
    });
    if (typeof dictateRecipe === "function") await check("Рецепты", "Правка рецепта голосом", async () => {
      await said("открой рецепт тестовые сырники"); need(recipe?.title === "Тестовые сырники", "свой рецепт не открылся");
      await said("добавь шаг подавайте горячими"); need(cookbook.find(x => x.title === "Тестовые сырники")?.steps.length === 3, "шаг не добавился");
      await said("на 2 порции"); need(recipe.servings === 2, "порции не пересчитались");
      recipe = null;
    });

    // ---------- services on the internet ----------
    await check("Сеть", "Погода", async () => { const w = await weatherSay(0); need(/градус/.test(w.text), "нет прогноза"); return w.text.split(".")[0]; });
    await check("Сеть", "Курс валют", async () => { const r = await rates("EUR", "PLN"); need(r, "банк не ответил"); return r.text; });
    await check("Сеть", "Новости", async () => { const n = await news(""); need(/^Свежие/.test(n.text), "лента пуста"); });
    await check("Сеть", "Википедия", async () => { const w = await wikiBest("Коперник"); need(/астроном/i.test(w.text), "статья не найдена"); });
    await check("Сеть", "Рецепты из интернета", async () => {
      const c = await recipeCandidates("борщ"); need(c.length, "поиск сайта пуст");
      const r = await recipeFromPage(c[0].url); need(r && r.ingredients.length && r.steps.length, "страница рецепта не разобралась");
      return `${c.length} найдено, «${r.title}»`;
    });
    await check("Сеть", "ИИ отвечает", async () => {
      const t = performance.now(); const o = parseJson(await callBrain([{ text: 'Ответь только JSON: {"ok":true}' }], "user"));
      need(o && o.ok === true, "ответ не по формату"); return Math.round((performance.now() - t) / 100) / 10 + " с";
    });
    await check("Сеть", "Поиск Google через Gemini", async () => {
      const blocked = [...SMART, ...LITE].filter(m => !(exhausted[m] > Date.now())).every(m => noGround[m] > Date.now());
      need(!blocked, "недоступен на бесплатном тарифе сейчас — работают новости и Википедия");
    }, { warnOnly: true });
    await check("Сеть", "Запасной мозг", async () => {
      need(typeof altId === "function" && altId(), "ключ не вставлен");
      const r = await altFetch([{ text: 'Ответь только JSON: {"ok":true}' }], "user");
      need(r.ok && parseJson(r.text)?.ok === true, r.quota ? "лимит на минуту исчерпан — попробуйте позже" : "не ответил (проверьте ключ)");
      return ALT[cfg.altProvider].label + " · " + (cfg.altModel || ALT[cfg.altProvider].model);
    }, { warnOnly: true });

    // ---------- the tablet itself ----------
    await check("Планшет", "Голос (синтез речи)", async () => {
      need(NATIVE?.benchVoice, "нет синтеза речи");
      const r = await new Promise(ok => { const t = setTimeout(() => ok("timeout"), 8000); window.__native.onBench = (s) => { clearTimeout(t); ok(s); }; NATIVE.benchVoice(NATIVE.voiceName()); });
      const [, first] = String(r).split("|"); need(+first >= 0, "голос не синтезируется"); return `первый звук через ${first} мс`;
    });
    await check("Планшет", "Микрофон и распознавание", async () => {
      need(!NATIVE || NATIVE.canListen(), "распознавание речи недоступно");
      const last = hearLog[hearLog.length - 1];
      return cfg.ambient ? (last ? `последняя фраза услышана ${Math.round((Date.now() - last.at) / 60000)} мин назад` : "фраз ещё не было") : "слух комнаты выключен";
    });
    await check("Планшет", "Камера", async () => { need(camOK && video.readyState >= 2 && !video.paused, "камера не показывает картинку"); });
    await check("Планшет", "Узнавание лиц", async () => { need(typeof faceReady !== "undefined" && faceReady, "модель лиц не загружена"); return family.length ? `знакомых: ${family.length}` : "пока никого не знает"; }, { warnOnly: true });
    await check("Планшет", "Память приложения", async () => { store.set("selftest.probe", 42); need(store.get("selftest.probe", 0) === 42, "хранилище не записывает"); localStorage.removeItem("hp.selftest.probe"); });
    await check("Планшет", "Ошибки в коде за сутки", async () => {
      const recent = store.get("errLog", []).filter(e => Date.now() - e.at < 864e5);
      need(!recent.length, `${recent.length}: ${recent.slice(-2).map(e => e.msg.slice(0, 80)).join(" | ")}`);
    }, { warnOnly: true });
    await check("Планшет", "Экран", async () => {
      need($("clock").textContent === hm(), "часы стоят"); need(document.body.classList.contains("minimal") || cfg.theme === "studio", "оформление не применилось");
    });
  } finally {
    // ---------- everything back as it was ----------
    for (const [name, fn] of Object.entries(real)) window[name] = fn;
    if (realPolish) window.polishRecipe = realPolish;
    fam.guestOnly = realGuest; onboarding = wasOnboarding;
    const m = JSON.parse(mem);
    tasks = m.tasks; shop = m.shop; timers = m.timers; dialog = m.dialog; facts = m.facts; recipe = m.recipe;
    if (typeof pantry !== "undefined") pantry = m.pantry;
    if (typeof cookbook !== "undefined") cookbook = m.cookbook;
    if (typeof meds !== "undefined") { meds = m.meds; medLog = m.medLog; }
    if (typeof draft !== "undefined") draft = m.draft;
    ({ lastTaskId, lastReminder, moreText, followupUntil, captureNext, earMode, heardCarry, privateShow } = keepVars);
    for (let k = localStorage.length - 1; k >= 0; k--) { const key = localStorage.key(k); if (key.startsWith("hp.") && !(key in ls)) localStorage.removeItem(key); }
    for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
    renderTasks(); renderShop(); renderNow(); renderTimers();
    if (typeof renderPantry === "function") renderPantry();
    if (typeof renderMeds === "function") renderMeds();
    if (!recipe) { const sh = $("recipeSheet"); if (openSheetEl === sh) closeSheet(true); }
    selfTesting = false; setState("idle"); resumeEar();
  }

  const run = { at: Date.now(), ms: Math.round(performance.now() - started), results };
  store.set("selfTestLast", run);
  showSelfTest(run, quiet);
  return run;
}

// ---------- the report ----------
const ST_MARK = { ok: "✓", warn: "!", fail: "✗" };
function showSelfTest(run, quiet) {
  const fails = run.results.filter(r => r.level === "fail"), warns = run.results.filter(r => r.level === "warn");
  const ul = $("selfList"); ul.textContent = "";
  let group = "";
  for (const r of [...fails, ...warns, ...run.results.filter(x => x.level === "ok")]) {
    const g_ = r.level === "ok" ? r.group : r.level === "fail" ? "Сломано" : "Внимание";
    if (g_ !== group) { group = g_; const h = document.createElement("li"); h.className = "ghead"; h.textContent = group; ul.append(h); }
    const li = document.createElement("li"); li.className = "st-" + r.level;
    li.innerHTML = '<span class="mk"></span><span class="txt"><span class="nm"></span><small></small></span><span class="ms"></span>';
    li.querySelector(".mk").textContent = ST_MARK[r.level]; li.querySelector(".nm").textContent = r.name;
    li.querySelector("small").textContent = r.note; li.querySelector(".ms").textContent = r.ms >= 1000 ? (r.ms / 1000).toFixed(1) + " с" : r.ms + " мс";
    ul.append(li);
  }
  $("selfSum").textContent = `${run.results.length} проверок за ${(run.ms / 1000).toFixed(0)} с · ${new Date(run.at).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`;
  const n = run.results.length;
  const line = fails.length
    ? `${g("Проверил", "Проверила")} ${n} ${plural(n, "пункт", "пункта", "пунктов")}. ${plural(fails.length, "Сломан", "Сломаны", "Сломано")} ${fails.length}: ${listWords(fails.map(f => lowFirst(f.name)), 4)}. Подробности на экране.`
    : `${g("Проверил", "Проверила")} ${n} ${plural(n, "пункт", "пункта", "пунктов")}: всё работает${warns.length ? `, ${warns.length} ${plural(warns.length, "замечание", "замечания", "замечаний")} на экране` : ""}.`;
  if (quiet && !fails.length) { toast(`Самопроверка после обновления: всё работает${warns.length ? " (замечаний: " + warns.length + ")" : ""}`, "check"); return; }
  openSheet($("selfSheet"));
  speak(line);
}
$("selfClose").onclick = () => closeSheet();

// ---------- by voice, and after every update ----------
function selfTestLocal(text, low) {
  if (/^(проверь себя|самопроверк\S*|самодиагностик\S*|проведи (само)?проверку|проверь (все )?(навыки|систему)|ты в порядке)[.!?]?$/.test(low)) {
    showSay("Проверяю себя, это займёт около минуты…"); setState("thinking");
    selfTest().catch(e => { logError("selftest: " + e.message); speak("Самопроверка сама споткнулась: " + e.message); });
    return true;
  }
  if (/^(покажи|что показала) (последн\S* )?(само)?проверк/.test(low)) { const r = store.get("selfTestLast", null); if (r) showSelfTest(r, false); else speak("Самопроверку ещё не запускали."); return true; }
  return false;
}
// a new version was installed: check it once, quietly, when nothing is going on
setTimeout(function afterUpdate() {
  const built = NATIVE?.installedAt ? String(NATIVE.installedAt()) : null;
  if (!built || store.get("testedBuild", "") === built) return;
  if (busy || speaking || listeningOnce || ringing || recipe || openSheetEl || (typeof dictating !== "undefined" && dictating)) { setTimeout(afterUpdate, 60000); return; }
  store.set("testedBuild", built);
  selfTest({ quiet: true }).catch(e => logError("selftest: " + e.message));
}, 90000);
