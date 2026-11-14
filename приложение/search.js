// Search: the brain asks for a lookup, this file finds the answer. In order of strength:
// 1) Google Search through Gemini (fresh, any topic, with sources) — when the free tier allows it;
// 2) specialised free sources: currency rates (National Bank of Poland, open.er-api), news (Google News RSS);
// 3) Wikipedia (Russian, then English) and DuckDuckGo instant answers.
// Everything that comes back is data for the answer, never instructions (the prompt says so too).

// ---------- 1. Google Search through Gemini ----------
// A grounding refusal (429) must not mark the model as out of quota for normal talk, so this has its own fetch.
const noGround = store.get("noGround", {});
async function groundedSearch(q) {
  if (!cfg.key) return null;
  const now = Date.now();
  const models = [...SMART, ...LITE].filter(m => !(exhausted[m] > now) && !(noGround[m] > now)).slice(0, 3);
  const when = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const text = `Найди в интернете ответ и скажи его по-русски одной-двумя короткими фразами для озвучки вслух: без ссылок, списков, markdown и вводных слов, только факты из найденного. Если надёжного ответа нет — так и скажи. Сегодня ${when}${cfg.city ? `, человек живёт в городе ${cfg.city}` : ""}. Вопрос: ${q}`;
  for (const m of models) {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const gen = { temperature: 0.2, maxOutputTokens: 600 };
      if (SMART.includes(m)) gen.thinkingConfig = { thinkingLevel: "low" };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.key },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], tools: [{ google_search: {} }], generationConfig: gen }),
      });
      if (r.status === 429 || r.status === 403 || r.status === 400) { noGround[m] = Date.now() + 3 * 3600000; store.set("noGround", noGround); continue; }
      if (!r.ok) continue;
      bumpUsage("search");
      const c = (await r.json()).candidates?.[0];
      const answer = (c?.content?.parts || []).filter(p => !p.thought).map(p => p.text || "").join("").trim();
      const chunks = c?.groundingMetadata?.groundingChunks || [];
      if (!answer || !chunks.length) continue;   // not actually searched: no better than a guess
      const sites = [...new Set(chunks.map(x => x.web?.title || "").filter(Boolean))].slice(0, 3);
      return { text: answer.replace(/\[\d+(?:,\s*\d+)*\]/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim(), source: "Поиск Google · " + sites.join(", "), final: true };
    } catch { /* slow or offline: try the next model */ } finally { clearTimeout(timer); }
  }
  return null;
}

// ---------- 2a. currency rates ----------
const CUR = {   // code: [nominative singular, genitive singular] — "1 евро = 4,27 злотого"
  EUR: ["евро", "евро"], USD: ["доллар", "доллара"], PLN: ["злотый", "злотого"], RUB: ["рубль", "рубля"], UAH: ["гривна", "гривны"],
  GBP: ["фунт", "фунта"], CHF: ["франк", "франка"], CZK: ["чешская крона", "чешской кроны"], BYN: ["белорусский рубль", "белорусского рубля"],
  KZT: ["тенге", "тенге"], JPY: ["иена", "иены"], CNY: ["юань", "юаня"], TRY: ["лира", "лиры"],
};
const CUR_WORDS = [[/евро/, "EUR"], [/доллар|бакс/, "USD"], [/злот/, "PLN"], [/белорусск\S* рубл/, "BYN"], [/рубл/, "RUB"], [/гривн/, "UAH"], [/фунт/, "GBP"],
  [/франк/, "CHF"], [/крон/, "CZK"], [/тенге/, "KZT"], [/иен/, "JPY"], [/юан/, "CNY"], [/лир/, "TRY"]];
function curCodes(low) { return CUR_WORDS.filter(([re]) => re.test(low)).map(([, c]) => c).filter((c, i, a) => a.indexOf(c) === i); }
const num2 = (v) => v.toLocaleString("ru-RU", { minimumFractionDigits: v < 10 ? 2 : 0, maximumFractionDigits: v < 10 ? 2 : 1 });
async function rates(from = "EUR", to = "PLN") {
  from = String(from).toUpperCase(); to = String(to).toUpperCase();
  if (from === to) return null;
  let v = null, src = "", day = "";
  if (from === "PLN" || to === "PLN") {   // Poland: the National Bank's own daily rate
    const other = from === "PLN" ? to : from;
    const j = await getJson(`https://api.nbp.pl/api/exchangerates/rates/A/${other}/?format=json`).catch(() => null);
    const mid = j?.rates?.[0]?.mid;
    if (mid) { v = from === "PLN" ? 1 / mid : mid; src = "Национальный банк Польши"; day = j.rates[0].effectiveDate; }
  }
  if (v == null) {
    const j = await fetch(`https://open.er-api.com/v6/latest/${from}`).then(r => r.json()).catch(() => null);
    if (j?.rates?.[to]) { v = j.rates[to]; src = "open.er-api.com"; day = (j.time_last_update_utc || "").slice(5, 16); }
  }
  if (v == null) return null;
  const [n1] = CUR[from] || [from], [, g2] = CUR[to] || ["", to];
  return { text: `Один ${n1} сейчас стоит ${num2(v)} ${g2}.`, source: `Курс · ${src}${day ? " · " + day : ""}`, final: true };
}

// ---------- 2b. news ----------
async function news(q) {
  const base = "https://news.google.com/rss" + (q ? `/search?q=${encodeURIComponent(q)}&` : "?");
  const xml = await httpGet(base + "hl=ru&gl=PL&ceid=PL:ru");
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const items = [...doc.querySelectorAll("item")].slice(0, 6).map(it => {
    const t = it.querySelector("title")?.textContent || "", src = it.querySelector("source")?.textContent || "";
    return "- " + t.replace(/\s+-\s+[^-]+$/, "") + (src ? ` (${src})` : "");
  });
  if (!items.length) return { text: "Новостей по этому запросу не нашлось.", source: "Google Новости" };
  return { text: `Свежие заголовки${q ? " по запросу «" + q + "»" : ""}:\n${items.join("\n")}\nПерескажи главное в 2–3 фразах, без названий изданий.`, source: "Google Новости" };
}

// ---------- 3. encyclopedic: Wikipedia, Russian first ----------
async function wikiBest(q) {
  for (const lang of ["ru", "en"]) {
    const s = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=3&origin=*&srsearch=` + encodeURIComponent(q)).catch(() => null);
    const hits = s?.query?.search || [];
    if (!hits.length) continue;
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 3).map(w => w.slice(0, 5));
    const best = hits.find(h => words.some(w => h.title.toLowerCase().includes(w))) || hits[0];
    // more than the summary: the facts asked about are often a few paragraphs in
    const ex = await getJson(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exchars=3200&format=json&origin=*&titles=` + encodeURIComponent(best.title)).catch(() => null);
    const page = ex && Object.values(ex.query?.pages || {})[0];
    const body = String(page?.extract || "").replace(/\n{2,}/g, "\n").replace(/==+\s*([^=]+?)\s*==+/g, "$1:");
    if (body) return { text: body.slice(0, 3200) + (lang === "en" ? "\n(Статья на английском — ответь по-русски.)" : ""), source: "Википедия · " + best.title };
  }
  return { text: "В Википедии ничего не нашлось.", source: "Википедия" };
}

// the general web question: Google through Gemini; without it, fresh headlines and the encyclopedia together,
// so a question about something recent is not answered from an old article alone
async function webSearch(q) {
  const g = await groundedSearch(q);
  if (g) return g;
  const [n, w] = await Promise.all([news(q).catch(() => null), wikiBest(q).catch(() => null)]);
  const parts = [];
  if (w && !/ничего не нашлось/.test(w.text)) parts.push("Википедия: " + w.text);
  if (n && !/не нашлось/.test(n.text)) parts.push(n.text.replace(/\nПерескажи[\s\S]*$/, "").replace(/^Свежие заголовки[^:]*:/, "Свежие новости по теме:"));
  if (!parts.length) return { text: "Ничего не нашлось. Честно скажи, что не знаешь, и предложи спросить иначе.", source: "" };
  return { text: parts.join("\n\n") + "\nОтветь на вопрос по этим данным. Если их не хватает для точного ответа (особенно о свежих событиях) — так и скажи.",
    source: [w && !/ничего/.test(w.text) && w.source, n && "Google Новости"].filter(Boolean).join(" · ") };
}
