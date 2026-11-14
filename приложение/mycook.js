// One's own recipes, by voice. Two ways in:
//   «запиши мой рецепт» — a guided conversation: name → ingredients (a list at a time) → steps (one at a time)
//     → servings → a read-back and "сохранить?". Each answer can also be a command: «всё», «убери последнее»,
//     «повтори», «пауза», «отмена». The draft is kept, so «продолжим рецепт» picks up where it stopped.
//   «запиши рецепт: …» with everything in one breath — the AI sorts it into ingredients and steps.
// The draft is on screen while it grows. Saved recipes go to the recipe book with their author, and can be
// changed by voice while open: «добавь шаг …», «убери ингредиент …», «исправь шаг 3: …», «удали этот рецепт».
"use strict";

let draft = store.get("recipeDraft", null);   // {title, ingredients:[], steps:[{text,timer_sec}], servings, author, phase}
let dictating = false;
const saveDraft = () => store.set("recipeDraft", draft);

const DONE = /^(вс[её]|готово|хватит|это вс[её]|закончил\S*|конец|дальше|следующ\S*|больше нет|нет больше)[.!]?$/;
const UNDO = /^(убери|удали|отмени|сотри) (последн\S*|это)/;
const REPEAT = /^(повтори|что записал\S*|прочитай|что получилось)/;
const PAUSE = /^(пауза|потом|позже|подожди|отложим|продолжим потом)/;
const CANCEL = /^(отмена|отмени рецепт|не надо|отбой|забудь (этот )?рецепт)/;

// ---------- understanding what was said ----------
// "200 грамм муки, два яйца и щепотку соли" → ["200 г муки", "2 яйца", "щепотку соли"]
function dictatedIngredients(text) {
  const t = (typeof digitize === "function" ? digitize(text.toLowerCase()) : text.toLowerCase())
    .replace(/(\d)\s*(грамм\S*|гр\.?)(?=\s|,|$)/g, "$1 г").replace(/(\d)\s*килограмм\S*/g, "$1 кг").replace(/(\d)\s*миллилитр\S*/g, "$1 мл").replace(/(\d)\s*литр\S*/g, "$1 л")
    .replace(/столов\S* ложк\S*/g, "ст. л.").replace(/чайн\S* ложк\S*/g, "ч. л.");
  // every "и" separates two foods in a dictated list ("соль и сахар по вкусу" are two lines, so "убери последнее" takes one)
  return t.split(/\s*[,;]\s*|\s+и\s+/).map(s => s.replace(/^(ещё|еще|также|и|плюс)\s+/, "").replace(/[.!]+$/, "").trim()).filter(s => s.length > 1);
}
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
function draftStep(text) {
  const t = cap(text.trim().replace(/^(потом|затем|дальше|далее|после этого|шаг \d+)[,:]?\s+/i, ""));
  return { text: /[.!?]$/.test(t) ? t : t + ".", timer_sec: typeof stepTimer === "function" ? stepTimer(t) : 0 };
}

// ---------- the draft on screen ----------
function showDraft(note) {
  recipe = { title: draft.title || "Новый рецепт", ingredients: draft.ingredients.slice(), steps: draft.steps.length ? draft.steps.slice() : [{ text: "", timer_sec: 0 }],
    i: 0, draft: true, note: note || "", servings: draft.servings, baseServings: draft.servings, author: draft.author };
  openRecipe();
}

// ---------- the guided conversation ----------
// waits a little longer than a normal question: people think, stir and wash hands while dictating
async function askDraft(question) { const a = await askUser(question, 20000); return a.trim(); }
async function dictateRecipe(resume) {
  if (dictating) return;
  dictating = onboarding = true;
  closeSheet(true); stopAmbient();
  try {
    if (!resume || !draft) draft = { title: "", ingredients: [], steps: [], servings: null, author: fam.speakerName() || null, phase: "title" };
    saveDraft();
    if (resume && draft.title) { showDraft("Продолжаем"); if (draft.phase !== "confirm") await say(`Продолжаем «${draft.title}».`); }
    let silence = 0;
    // one answer; silence twice in a row means the cook is busy: the draft waits
    const listen = async (q) => {
      const a = await askDraft(q);
      if (!a) { silence++; if (silence >= 2) throw new Error("pause"); return null; }
      silence = 0;
      const low = a.toLowerCase().replace(/[.!?]+$/, "");
      if (CANCEL.test(low)) throw new Error("cancel");
      if (PAUSE.test(low)) throw new Error("pause");
      return { text: a, low };
    };

    // 1. the name
    while (draft.phase === "title") {
      const a = await listen("Записываю ваш рецепт. Как называется блюдо?");
      if (!a) continue;
      draft.title = cap(a.text.replace(/^(называется|это|блюдо|рецепт)\s+/i, "").replace(/[.!?]+$/, "")).slice(0, 60);
      draft.phase = "ingredients"; saveDraft(); showDraft("Ингредиенты");
    }

    // 2. the ingredients, a list at a time
    let first = true;
    while (draft.phase === "ingredients") {
      const a = await listen(first ? (draft.ingredients.length ? `Есть ${draft.ingredients.length} ${plural(draft.ingredients.length, "ингредиент", "ингредиента", "ингредиентов")}. Продолжайте или скажите «всё».` : "Диктуйте ингредиенты с количеством, можно сразу списком. Когда закончите — скажите «всё».") : "Дальше?");
      first = false;
      if (!a) continue;
      if (DONE.test(a.low)) { if (!draft.ingredients.length) { await say("Пока ни одного ингредиента. Назовите хотя бы один."); continue; } draft.phase = "steps"; break; }
      if (UNDO.test(a.low)) { const x = draft.ingredients.pop(); saveDraft(); showDraft("Ингредиенты"); await say(x ? `Убрала: ${x}.`.replace("Убрала", g("Убрал", "Убрала")) : "Убирать нечего."); continue; }
      if (REPEAT.test(a.low)) { await say(draft.ingredients.length ? listWords(draft.ingredients, 20) + "." : "Пока пусто."); continue; }
      const items = dictatedIngredients(a.text);
      draft.ingredients.push(...items); saveDraft(); showDraft("Ингредиенты");
      tone(SND.done);   // a short sound instead of reading everything back: the list is on the screen
    }
    saveDraft();

    // 3. the steps, one at a time
    first = true;
    while (draft.phase === "steps") {
      const n = draft.steps.length + 1;
      const a = await listen(first ? (draft.steps.length ? `Записано ${draft.steps.length} ${plural(draft.steps.length, "шаг", "шага", "шагов")}. Шаг ${n}?` : "Теперь шаги, по одному. Шаг первый?") : `Шаг ${n}?`);
      first = false;
      if (!a) continue;
      if (DONE.test(a.low)) { if (!draft.steps.length) { await say("Нужен хотя бы один шаг."); continue; } draft.phase = "servings"; break; }
      if (UNDO.test(a.low)) { const x = draft.steps.pop(); saveDraft(); showDraft("Шаги"); await say(x ? `Убрала шаг ${draft.steps.length + 1}.`.replace("Убрала", g("Убрал", "Убрала")) : "Убирать нечего."); continue; }
      if (REPEAT.test(a.low)) { await say(draft.steps.length ? draft.steps.map((s, k) => `${k + 1}: ${s.text}`).join(" ") : "Шагов пока нет."); continue; }
      const st = draftStep(a.text);
      draft.steps.push(st); saveDraft(); showDraft("Шаги");
      if (st.timer_sec) await say(`Шаг ${n}, с таймером на ${timeLeftText(st.timer_sec)}.`); else tone(SND.done);
    }

    // 4. servings (may be skipped)
    if (draft.phase === "servings") {
      const a = await listen("На сколько порций? Можно сказать «пропусти».");
      if (a && !/пропус|не знаю|неважно|не важно/.test(a.low)) {
        const n = parseInt((typeof digitize === "function" ? digitize(a.low) : a.low).replace(/\D+/g, " ").trim(), 10);
        if (n > 0 && n < 100) draft.servings = n;
      }
      draft.phase = "confirm"; saveDraft();
    }

    // 5. tidy up with the AI (names in the nominative, amounts after them), read back, save
    if (draft.phase === "confirm") {
      showSay("Привожу рецепт в порядок…"); setState("thinking");
      const tidy = await polishRecipe(draft).catch(() => null);
      if (tidy) { draft.ingredients = tidy.ingredients; draft.steps = tidy.steps; }
      saveDraft(); showDraft("Проверьте");
      const a = await listen(`«${draft.title}»: ${draft.ingredients.length} ${plural(draft.ingredients.length, "ингредиент", "ингредиента", "ингредиентов")}, ${draft.steps.length} ${plural(draft.steps.length, "шаг", "шага", "шагов")}${draft.servings ? `, на ${draft.servings} ${plural(draft.servings, "порцию", "порции", "порций")}` : ""}. Сохранить?`);
      if (a && YES.test(a.low)) {
        const r = { title: draft.title, ingredients: draft.ingredients, steps: draft.steps, i: 0, servings: draft.servings, baseServings: draft.servings,
          source: draft.author ? "рецепт " + draft.author : "свой рецепт", author: draft.author, own: true };
        saveToBook(r); draft = null; store.set("recipeDraft", null);
        recipe = null; renderRecipe();
        await say(`${g("Сохранил", "Сохранила")}. Когда будете готовить, скажите «открой рецепт ${lowFirst(r.title)}».`);
      } else {
        draft.phase = "steps"; saveDraft();
        await say("Не сохраняю. Можно добавить шаги — скажите «продолжим рецепт», или «отмена», чтобы удалить черновик.");
      }
    }
  } catch (e) {
    if (e.message === "cancel") { draft = null; store.set("recipeDraft", null); recipe = null; renderRecipe(); await say("Хорошо, черновик удалён."); }
    else if (e.message === "pause") { saveDraft(); recipe = null; renderRecipe(); await say("Черновик сохранён. Скажите «продолжим рецепт», когда будете готовы."); }
    else { saveDraft(); logError("dictate: " + e.message); await say("Что-то пошло не так, но черновик сохранён. Скажите «продолжим рецепт»."); }
  } finally { dictating = onboarding = false; captureNext = null; resumeEar(); }
}

// one AI pass: "200 г муки" → "Мука - 200 г", tidy punctuation, keep the meaning. Without the AI: as dictated.
async function polishRecipe(d) {
  if (!cfg.key && !(typeof altId === "function" && altId())) return null;
  const prompt = `Приведи продиктованный голосом рецепт в аккуратный вид. Ничего не добавляй и не выдумывай, смысл и количества не меняй.
Ингредиенты — в виде «Название - количество единица» (название в именительном падеже, единицы: г, кг, мл, л, шт., ст. л., ч. л., по вкусу). Шаги — исправь ошибки распознавания речи и пунктуацию, каждый шаг отдельной фразой; timer_sec — секунды ожидания, если в шаге названо время, иначе 0.
Блюдо: ${d.title}
Ингредиенты, как продиктовали: ${JSON.stringify(d.ingredients)}
Шаги, как продиктовали: ${JSON.stringify(d.steps.map(s => s.text))}
Ответь только JSON: {"ingredients":["…"],"steps":[{"text":"…","timer_sec":0}]}`;
  const raw = await callBrain([{ text: prompt }], "user");
  const o = parseJson(raw);
  if (!Array.isArray(o.ingredients) || !Array.isArray(o.steps) || !o.steps.length) return null;
  return { ingredients: o.ingredients.map(x => cap(String(x).replace(/(\d)\.(\d)/g, "$1,$2"))).filter(Boolean), steps: o.steps.map(s => ({ text: String(s.text || s), timer_sec: Math.max(0, Math.round(+s.timer_sec || 0)) })).filter(s => s.text) };
}

// «запиши рецепт: …» in one breath: the AI sorts it out, then the same read-back
async function recipeFromSpeech(text) {
  showSay("Разбираю рецепт…"); setState("thinking");
  const prompt = `Человек продиктовал рецепт голосом одним куском. Разбери его. Ничего не добавляй от себя.
Текст: «${text}»
Ответь только JSON: {"title":"название блюда","servings":число или null,"ingredients":["Название - количество единица"],"steps":[{"text":"…","timer_sec":0}]}`;
  const o = parseJson(await callBrain([{ text: prompt }], "user"));
  if (!o?.title || !Array.isArray(o.steps) || !o.steps.length) return false;
  draft = { title: cap(String(o.title)).slice(0, 60), ingredients: (o.ingredients || []).map(x => String(x).replace(/(\d)\.(\d)/g, "$1,$2")), steps: o.steps.map(s => ({ text: String(s.text || s), timer_sec: Math.max(0, Math.round(+s.timer_sec || 0)) })),
    servings: +o.servings || null, author: fam.speakerName() || null, phase: "confirm" };
  saveDraft();
  dictateRecipe(true);
  return true;
}

// ---------- changing a saved recipe of one's own while it is open ----------
function bookRecipe() { return recipe && !recipe.draft ? cookbook.find(r => r.title === recipe.title) || null : null; }
function editOwnRecipe(text, low) {
  const r = bookRecipe(); if (!r) return false;
  const sync = (msg) => { recipe = { ...r, i: Math.min(recipe.i, r.steps.length - 1), candidates: recipe.candidates }; store.set("cookbook", cookbook); renderRecipe(); sayLocal(text, msg); return true; };
  let m;
  if ((m = /^добавь (?:в рецепт )?шаг[:,]?\s+(.{3,})$/.exec(low))) { r.steps.push(draftStep(text.slice(text.length - m[1].length))); return sync(`Добавила шаг ${r.steps.length}.`.replace("Добавила", g("Добавил", "Добавила"))); }
  if ((m = /^добавь (?:в рецепт )?ингредиент\S*[:,]?\s+(.{2,})$/.exec(low))) { const items = dictatedIngredients(m[1]); r.ingredients.push(...items); return sync(`Добавила: ${listWords(items)}.`.replace("Добавила", g("Добавил", "Добавила"))); }
  if ((m = /^(?:убери|удали) ингредиент\S*\s+(.{2,})$/.exec(low))) {
    const k = r.ingredients.findIndex(x => typeof sameFood === "function" ? sameFood(splitIngredient(x).name, m[1]) : x.toLowerCase().includes(m[1]));
    if (k < 0) return sync("Такого ингредиента нет в рецепте.");
    const [x] = r.ingredients.splice(k, 1); return sync(`Убрала: ${splitIngredient(x).name.toLowerCase()}.`.replace("Убрала", g("Убрал", "Убрала")));
  }
  if ((m = /^(?:удали|убери) шаг (\d+)/.exec(digitize(low)))) { const n = +m[1]; if (!r.steps[n - 1]) return sync("Такого шага нет."); r.steps.splice(n - 1, 1); return sync(`Шаг ${n} удалён.`); }
  if ((m = /^(?:исправь|замени|поменяй) шаг (\d+)[:,]?\s+(?:на\s+)?(.{3,})$/.exec(digitize(low)))) { const n = +m[1]; if (!r.steps[n - 1]) return sync("Такого шага нет."); r.steps[n - 1] = draftStep(m[2]); return sync(`Шаг ${n} исправлен.`); }
  if ((m = /^(?:переименуй|назови) (?:рецепт |его )?(?:в |на )?(.{3,})$/.exec(low))) { r.title = cap(m[1].replace(/[.!?]+$/, "")); return sync(`Теперь он называется «${r.title}».`); }
  if (/^удали (этот )?рецепт/.test(low)) {
    askUser(`Удалить «${r.title}» из ваших рецептов?`).then(a => {
      if (YES.test(a.toLowerCase())) { cookbook = cookbook.filter(x => x !== r); store.set("cookbook", cookbook); recipe = null; renderRecipe(); speak("Удалён."); }
      else speak("Оставляю.");
    });
    return true;
  }
  return false;
}

// ---------- the words that start it all ----------
function myCookLocal(text, low) {
  if (dictating) return false;
  if (/^(запиши|создай|добавь|сохрани) (мой |свой |новый )?рецепт[.!]?$|^(новый рецепт|мой рецепт|хочу записать (свой |мой )?рецепт)[.!]?$/.test(low)) { dictateRecipe(false); return true; }
  if (/^(продолж\S* (запись |записывать )?рецепт|вернёмся к рецепту|вернемся к рецепту)/.test(low) && draft) { dictateRecipe(true); return true; }
  const one = /^(?:запиши|сохрани) (?:мой |свой )?рецепт[:,]?\s+(.{30,})$/.exec(low);
  if (one) { recipeFromSpeech(text.slice(text.length - one[1].length)).then(ok => { if (!ok) dictateRecipe(false); }); return true; }
  return editOwnRecipe(text, low);
}
