"use strict";
// The household: who lives here, how each person looks, how to talk to each of them.
// Face prints and avatars never leave this tablet; the AI is only told names and roles.

let family = store.get("family", []);   // [{id, name, role, address, age, group, notes[], faces[][], avatar, consent, lastSeen}]
let faceReady = false, faceBusy = false, lastScan = 0, lastGreet = 0;
const seenAt = new Map();               // member id -> last time the face was seen
let guestSeenAt = 0;                    // last time an unknown face was seen
let mainFace = null;                    // the largest face in the last scan: {m, expr, at}
let greeted = store.get("greeted", {}); // member id -> date of today's hello
const MATCH = 0.5;                      // face distance: below this it is the same person
const LEARN = 0.42;                     // confident matches teach the model new lighting and angles
const EXPR = { happy: "улыбается", sad: "выглядит грустным", angry: "выглядит сердитым", surprised: "удивлён", fearful: "встревожен", disgusted: "недоволен", neutral: "" };

function saveFamily() { store.set("family", family); renderWho(); if ($("familyList")) renderFamily(); }
const member = (id) => family.find(m => m.id === id) || null;
function memberByName(name) {
  const n = String(name || "").trim().toLowerCase(); if (!n) return null;
  return family.find(m => m.name.toLowerCase() === n) || family.find(m => n.startsWith(m.name.toLowerCase().slice(0, 4))) || null;
}

// ---------- face models (bundled in the app) ----------
async function loadFaces() {
  if (typeof faceapi === "undefined") return;
  try {
    try { await faceapi.tf.setBackend("webgl"); } catch {}
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("models"),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri("models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("models"),
      faceapi.nets.faceExpressionNet.loadFromUri("models"),
    ]);
    faceReady = true;
  } catch (e) { console.warn("face recognition unavailable", e); }
}
async function detectFaces() {
  if (!faceReady || faceBusy || video.readyState < 2) return [];
  faceBusy = true;
  try {
    return await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true).withFaceDescriptors().withFaceExpressions();
  } catch { return []; } finally { faceBusy = false; }
}
function faceDistance(a, b) { let s = 0; for (let i = 0; i < 128; i++) { const d = a[i] - b[i]; s += d * d; } return Math.sqrt(s); }
function identify(desc) {
  let best = null, bd = 9;
  for (const m of family) for (const f of m.faces || []) { const d = faceDistance(desc, f); if (d < bd) { bd = d; best = m; } }
  return bd < MATCH ? { m: best, d: bd } : { m: null, d: bd };
}
const packFace = (desc) => Array.from(desc, v => Math.round(v * 1000) / 1000);

// ---------- who is here ----------
// scan often while something moves, rarely otherwise; never during enrollment (it runs its own loop)
// a scan holds the graphics chip for ~0.25 s, which froze the screen under a finger (99th-percentile frame
// 150 ms vs 65 ms without scans), so it waits while someone is touching the screen
let lastTouch = 0;
document.addEventListener("pointerdown", () => { lastTouch = Date.now(); }, true);
document.addEventListener("pointermove", () => { lastTouch = Date.now(); }, { capture: true, passive: true });
async function scanFaces() {
  const now = Date.now();
  if (!faceReady || enrolling || document.hidden || now - lastTouch < 4000) return;
  // one scan takes ~0.3 s of the graphics chip: often while someone moves or is being heard, rarely while the
  // assistant thinks or talks (who asked is already known, and the screen animates then)
  const st = document.body.dataset.state, talking = st === "thinking" || st === "searching" || st === "speaking";
  if (now - lastScan < (talking ? 5000 : now - lastMotion < 4000 ? 1500 : 12000)) return;
  lastScan = now;
  const faces = await detectFaces();
  if (!faces.length) { renderWho(); return; }
  let main = null;
  for (const f of faces) {
    const box = f.detection.box, area = box.width * box.height;
    const { m, d } = identify(f.descriptor);
    const [expr, p] = Object.entries(f.expressions).sort((a, b) => b[1] - a[1])[0];
    if (m) {
      seenAt.set(m.id, now); m.lastSeen = now;
      if (d < LEARN && now - (m.lastLearn || 0) > 10 * 60000) {   // keep up with lighting, glasses, haircuts
        m.faces.push(packFace(f.descriptor)); if (m.faces.length > 14) m.faces.splice(5, 1);
        m.lastLearn = now; store.set("family", family);
      }
    } else guestSeenAt = now;
    if (!main || area > main.area) main = { area, m, expr: p > 0.6 ? expr : "neutral", at: now };
  }
  mainFace = main;
  renderWho();
  maybeGreet();
}
setInterval(scanFaces, 700);
function membersHere(ms = 20000) { const now = Date.now(); return family.filter(m => now - (seenAt.get(m.id) || 0) < ms); }
function guestHere(ms = 20000) { return Date.now() - guestSeenAt < ms; }
function guestOnly() { return faceReady && guestHere() && !membersHere().length; }
function speaker() { return mainFace && Date.now() - mainFace.at < 6000 ? mainFace.m : null; }
function currentSpeakerName() { return speaker()?.name || null; }
// may a personal reminder be said out loud now? Only to its person, when we can tell they are here
function canDeliverTo(id) {
  const m = member(id); if (!m) return true;
  if (!faceReady || !(m.faces || []).length) return true;
  return membersHere(5 * 60000).some(x => x.id === id);
}
function renderWho() {
  const here = membersHere(), pill = $("whoPill");
  if (here.length) { pill.hidden = false; pill.classList.remove("guest"); $("whoLabel").textContent = here.map(m => m.name).join(", "); }
  else if (faceReady && guestHere()) { pill.hidden = false; pill.classList.add("guest"); $("whoLabel").textContent = "Гость"; }
  else pill.hidden = true;
  document.body.classList.toggle("guest", guestOnly());
}

// a short hello the first time someone shows up today (the first person of the morning gets the full plan instead)
function maybeGreet() {
  const m = mainFace?.m; if (!m || greeted[m.id] === today()) return;
  if (isQuiet() || peopleTalking() || speaking || listeningOnce || busy || briefing || enrolling) return;
  const h = new Date().getHours();
  if (h >= 6 && h < 12 && store.get("briefDay", "") !== today()) return;
  if (Date.now() - lastGreet < 120000) return;
  greeted[m.id] = today(); store.set("greeted", greeted); lastGreet = Date.now();
  const hi = h < 5 ? "Доброй ночи" : h < 12 ? "Доброе утро" : h < 18 ? "Добрый день" : "Добрый вечер";
  const mine = tasks.filter(t => !t.done && t.date === today() && t.who === m.id).length;
  const you = m.address === "ты" ? "тебя" : "вас";
  speak(`${hi}, ${m.name}!` + (mine ? ` У ${you} сегодня ${mine} ${plural(mine, "дело", "дела", "дел")}.` : ""));
}

// ---------- what the AI is told about the household ----------
function familyPrompt() {
  const lines = family.map(m => {
    const bits = [m.role, `обращаться на «${m.address}»`, m.group === "child" ? "ребёнок" : m.group === "elder" ? "пожилой человек" : null, m.age ? m.age + " лет" : null].filter(Boolean).join(", ");
    return `- ${m.name}${bits ? " — " + bits : ""}${(m.notes || []).length ? ". Важно: " + m.notes.join("; ") : ""}`;
  }).join("\n") || "пока ни с кем не " + g("знаком", "знакома");
  const here = membersHere();
  let now = here.length ? "Сейчас у планшета: " + here.map(m => m.name).join(", ") : faceReady && guestHere() ? "Сейчас у планшета незнакомый человек (гость)" : "Сейчас у планшета никого не видно или камера не различает лица";
  if (here.length && guestHere()) now += ", а также незнакомый человек";
  const who = speaker();
  const mood = mainFace && Date.now() - mainFace.at < 6000 ? EXPR[mainFace.expr] : "";
  return `Семья — люди, которые здесь живут:
${lines}
${now}.${who ? ` Говорит, скорее всего, ${who.name}.` : ""}${mood ? ` По лицу: ${mood}.` : ""}
Как общаться: иногда обращайся по имени (не в каждой фразе), на «ты» или «вы», как указано; с детьми — проще, короче и безопасно; с пожилыми — спокойнее и чётче. Подстраивай тон под настроение: если человек устал или расстроен — мягче и короче, если весел — можно бодрее. Не называй эмоции вслух без повода и не ставь диагнозов. Кто есть кто, тебе сообщает система распознавания выше — сама людей по внешности не определяй и внешность не описывай.
${guestOnly() ? "РЕЖИМ ГОСТЯ: рядом только незнакомый человек. Не называй членов семьи, не рассказывай их дела, напоминания, память, расписание, кто когда бывает дома и где они сейчас. Вежливо помогай с общими вопросами. Не пытайся узнать, кто этот человек, и ничего о нём не запоминай." : ""}`;
}

// ---------- acquaintance: a short guided conversation ----------
let enrolling = false;
const YES = /^(да|ага|конечно|можно|давай|хорошо|ок|окей|угу|разрешаю|согласен|согласна|запомни)/i;
const NO = /^(нет|не надо|не нужно|не хочу|запрещаю|не стоит)/i;
function askUser(question, timeout = 14000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (t) => { if (done) return; done = true; captureNext = null; clearTimeout(timer); resolve(String(t || "").trim()); };
    captureNext = finish;
    const timer = setTimeout(() => finish(""), timeout + question.length * 90);
    speak(question, { then: () => listenOnce(true) });
  });
}
const say = (text) => new Promise((r) => speak(text, { then: r }));
function parseName(t) {
  const s = String(t || "").replace(/[.,!?«»"]/g, " ").replace(/^\s*(меня зовут|зовут|моё имя|мое имя|я|это)\s+/i, "").trim();
  const w = s.split(/\s+/).filter(Boolean).slice(0, 2);
  return w.length ? w.map(x => x[0].toUpperCase() + x.slice(1).toLowerCase()).join(" ") : null;
}
async function startAcquaintance(knownName) {
  if (enrolling) return;
  enrolling = onboarding = true;
  closeSheet(true); stopAmbient();
  try {
    let name = knownName ? parseName(knownName) : null;
    for (let i = 0; !name && i < 2; i++) name = parseName(await askUser(i ? g("Не расслышал", "Не расслышала") + ". Скажите, пожалуйста, только имя." : "Давайте познакомимся! Как вас зовут?"));
    if (!name) { await say("Хорошо, познакомимся позже."); return; }
    let m = memberByName(name);
    if (m) {
      const again = await askUser(`Мы уже знакомы, ${m.name}! Обновить, как ${m.address === "ты" ? "ты выглядишь" : "вы выглядите"}?`);
      if (YES.test(again)) await enrollFace(m);
      else await say("Хорошо, ничего не меняю.");
      return;
    }
    m = { id: Math.random().toString(36).slice(2, 8), name, role: "", address: "вы", age: null, group: "adult", notes: [], faces: [], avatar: null, consent: null, lastSeen: 0 };
    const role = await askUser(`Очень приятно, ${name}! Кем вы приходитесь в семье? Например: мама, сын, бабушка.`);
    if (role && !NO.test(role)) m.role = role.replace(/^(я|это)\s+/i, "").slice(0, 40).toLowerCase();
    const addr = await askUser("Как вам удобнее: на ты или на вы?");
    m.address = /(^|\s)ты($|\s)|на ты|тыкать/i.test(addr) ? "ты" : "вы";
    const you = m.address === "ты";
    const age = await askUser(you ? "Сколько тебе лет? Можно не отвечать." : "Сколько вам лет? Можно не отвечать.");
    const n = +(/(\d{1,3})/.exec(age) || [])[1];
    if (n > 0 && n < 120) { m.age = n; m.group = n < 14 ? "child" : n >= 65 ? "elder" : "adult"; }
    family.push(m); saveFamily();
    const consent = await askUser(you
      ? "Можно я запомню, как ты выглядишь, чтобы узнавать тебя? Снимки лица останутся только на этом планшете."
      : "Можно я запомню, как вы выглядите, чтобы узнавать вас? Снимки лица останутся только на этом планшете.");
    if (YES.test(consent)) { m.consent = new Date().toISOString(); await enrollFace(m); }
    else await say("Хорошо, лицо запоминать не буду. Узнаю по имени, если представитесь.");
    const notes = await askUser(you ? "Что мне важно о тебе знать? Например, аллергии, привычки, что любишь. Можно сказать «ничего»." : "Что мне важно о вас знать? Например, аллергии, привычки, что вы любите. Можно сказать «ничего».");
    if (notes && !/^(ничего|нет|не знаю|всё|потом|пропусти)/i.test(notes)) { m.notes.push(notes.slice(0, 200)); saveFamily(); }
    remember("assistant", `${g("Познакомился", "Познакомилась")} с ${name}${m.role ? " (" + m.role + ")" : ""}.`);
    await say(you ? `Приятно познакомиться, ${name}! Теперь ты часть моей семьи.` : `Приятно познакомиться, ${name}! Теперь вы часть моей семьи.`);
    toast("В семье: " + name, "user");
  } finally {
    enrolling = onboarding = false; captureNext = null; resumeEar(); renderWho();
  }
}
// face samples from a few angles; the first one becomes the avatar
async function enrollFace(m) {
  if (!faceReady) { await say("Распознавание лиц ещё загружается. Запишем лицо чуть позже — в настройках, раздел «Семья»."); return false; }
  const you = m.address === "ты";
  await say(you ? "Посмотри прямо в камеру." : "Посмотрите прямо в камеру.");
  const samples = [];
  const until = Date.now() + 20000;
  let hinted = 0;
  while (Date.now() < until && samples.length < 6) {
    const faces = await detectFaces();
    const size = (x) => x.detection.box.width * x.detection.box.height;
    const f = faces.sort((a, b) => size(b) - size(a))[0];
    if (f && f.detection.score > 0.6 && f.detection.box.width > 70) {
      if (!samples.length) m.avatar = avatarFrom(f.detection.box);
      samples.push(packFace(f.descriptor));
      if (samples.length === 2 && hinted === 0) { hinted = 1; speak(you ? "Теперь чуть поверни голову влево." : "Теперь чуть поверните голову влево."); }
      if (samples.length === 4 && hinted === 1) { hinted = 2; speak(you ? "И немного вправо." : "И немного вправо."); }
    }
    await new Promise(r => setTimeout(r, 450));
  }
  if (samples.length < 3) { await say("Не получилось хорошо разглядеть лицо. Подойдите ближе к камере — повторим в настройках, раздел «Семья»."); return false; }
  m.faces = samples.concat(m.faces || []).slice(0, 14);
  m.consent = m.consent || new Date().toISOString();
  saveFamily();
  await say("Готово, " + g("запомнил", "запомнила") + (you ? " тебя." : " вас."));
  return true;
}
function avatarFrom(box) {
  const c = document.createElement("canvas"); c.width = c.height = 96;
  const side = Math.max(box.width, box.height) * 1.5, cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const x = c.getContext("2d");
  x.translate(96, 0); x.scale(-1, 1);   // mirror, like the preview
  x.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, 96, 96);
  return c.toDataURL("image/jpeg", 0.75);
}
async function forgetMe() {
  const m = speaker();
  if (!m) { speak("Не узнаю, кто говорит. Удалить человека можно в настройках, раздел «Семья»."); return; }
  enrolling = onboarding = true;
  try {
    const ok = await askUser(m.address === "ты" ? `${m.name}, точно забыть всё о тебе, вместе с лицом?` : `${m.name}, точно забыть всё о вас, вместе с лицом?`);
    if (YES.test(ok)) { removeMember(m.id); await say("Готово, я всё " + g("забыл", "забыла") + "."); } else await say("Хорошо, ничего не удаляю.");
  } finally { enrolling = onboarding = false; captureNext = null; resumeEar(); }
}
function removeMember(id) {
  family = family.filter(m => m.id !== id); seenAt.delete(id);
  tasks.forEach(t => { if (t.who === id) t.who = null; }); store.set("tasks", tasks);
  delete greeted[id]; store.set("greeted", greeted); saveFamily(); renderTasks();
}
function addMemberNote(name, note) {
  const m = memberByName(name); note = String(note || "").trim().slice(0, 160);
  if (!m || !note || m.notes.some(x => x.toLowerCase() === note.toLowerCase())) return;
  m.notes.push(note); m.notes = m.notes.slice(-12); saveFamily(); toast(`${g("Запомнил", "Запомнила")} про ${m.name}`, "user");
}

// ---------- settings: the family list ----------
function renderFamily() {
  const box = $("familyList"); box.textContent = "";
  if (!family.length) { box.innerHTML = `<div id="factsEmpty">Пока ни с кем не знакомы. Нажмите «Познакомиться» или скажите «Помощник, давай познакомимся».</div>`; return; }
  for (const m of family) {
    const row = document.createElement("div"); row.className = "fam";
    const sub = [m.role, "на «" + m.address + "»", m.age ? m.age + " лет" : null, (m.faces || []).length ? "лицо: " + m.faces.length + " " + plural(m.faces.length, "снимок", "снимка", "снимков") : "лицо не записано"].filter(Boolean).join(" · ");
    row.innerHTML = `<div class="ava"></div><div class="lbl"><b></b><small></small></div>
      <button class="mini press" data-a="face">${icon("camera")}Лицо</button><button class="fdel press" aria-label="Удалить">${icon("trash")}</button>`;
    const ava = row.querySelector(".ava");
    if (m.avatar) { const img = new Image(); img.src = m.avatar; img.alt = ""; ava.append(img); } else ava.textContent = m.name[0];
    row.querySelector("b").textContent = m.name; row.querySelector("small").textContent = sub;
    row.querySelector('[data-a="face"]').onclick = async () => {
      closeSheet(true); enrolling = onboarding = true;
      try { m.consent = m.consent || new Date().toISOString(); await enrollFace(m); } finally { enrolling = onboarding = false; resumeEar(); }
    };
    row.querySelector(".fdel").onclick = () => { removeMember(m.id); toast("Удалено: " + m.name, "trash"); };
    box.append(row);
  }
}
$("famAdd").onclick = () => { haptic(); startAcquaintance(null); };
renderWho();
loadFaces();
