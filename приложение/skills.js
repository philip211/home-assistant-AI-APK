// Skills that work without the AI: reminders and alarms are understood on the tablet itself, so they are
// instant, cost no quota and keep working when Google is out of quota or the internet is down.
// Only clear phrases are taken here; anything unsure goes to the AI as before.

// ---------- numbers said as words: "в девять тридцать" → "в 9 30" ----------
const NUM_WORDS = { "ноль": 0, "один": 1, "одну": 1, "одна": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6, "семь": 7,
  "восемь": 8, "девять": 9, "десять": 10, "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13, "четырнадцать": 14, "пятнадцать": 15,
  "шестнадцать": 16, "семнадцать": 17, "восемнадцать": 18, "девятнадцать": 19, "двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50 };
function digitize(low) {
  const w = low.split(/\s+/), out = [];
  for (let i = 0; i < w.length; i++) {
    let v = NUM_WORDS[w[i]];
    if (v == null) { out.push(w[i]); continue; }
    const u = NUM_WORDS[w[i + 1]];
    if (v >= 20 && v % 10 === 0 && u > 0 && u < 10) { v += u; i++; }
    out.push(String(v));
  }
  return out.join(" ");
}

// ---------- when: "завтра в 9", "через 20 минут", "в пятницу вечером", "по будням в 7:30" ----------
const WD = { "понедельник": 1, "вторник": 2, "среду": 3, "четверг": 4, "пятницу": 5, "субботу": 6, "воскресенье": 0 };
const WD_PLURAL = { "понедельникам": 1, "вторникам": 2, "средам": 3, "четвергам": 4, "пятницам": 5, "субботам": 6, "воскресеньям": 0 };
const PART_OF_DAY = { "утром": "09:00", "днём": "13:00", "днем": "13:00", "вечером": "19:00", "перед сном": "22:00", "в полдень": "12:00", "в полночь": "00:00" };
const pad2 = (n) => String(n).padStart(2, "0");
function nextWeekday(wd) { const d = new Date(); for (let i = 0; i < 7; i++) { if (d.getDay() === wd) return ymd(d); d.setDate(d.getDate() + 1); } return today(); }

function parseWhen(src, { alarm = false } = {}) {
  let s = " " + digitize(src) + " ";
  const cut = (re) => { const m = re.exec(s); if (m) s = s.slice(0, m.index) + " " + s.slice(m.index + m[0].length); return m; };
  let date = null, time = null, repeat = null, m;

  if (cut(/\s(?:каждый день|ежедневно)\s/)) repeat = "daily";
  else if (cut(/\s(?:по будням|по рабочим дням)\s/)) repeat = "weekdays";
  else if (cut(/\s(?:по выходным)\s/)) repeat = "weekends";
  else if ((m = cut(/\s(?:кажд(?:ый|ую|ое)\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|по\s+(понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям))\s/))) {
    repeat = "weekly"; date = nextWeekday(m[1] ? WD[m[1]] : WD_PLURAL[m[2]]);
  }

  // "через 20 минут", "через час", "через полтора часа", "через полчаса"
  if ((m = cut(/\sчерез\s+(?:(\d+(?:[.,]5)?)\s+)?(полчаса|полтора часа|минут[уы]?|час(?:а|ов)?)\s/))) {
    const n = m[1] ? +m[1].replace(",", ".") : 1;
    const min = m[2] === "полчаса" ? 30 : m[2] === "полтора часа" ? 90 : /^минут/.test(m[2]) ? n : n * 60;
    const at = new Date(Date.now() + min * 60000);
    return finishWhen(s, ymd(at), hm(at), repeat);
  }

  if (!date) {
    if (cut(/\sпослезавтра\s/)) date = addDays(2);
    else if (cut(/\sзавтра\s/)) date = addDays(1);
    else if (cut(/\sсегодня\s/)) date = today();
    else if ((m = cut(/\sв?о?\s?(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)\s/))) date = nextWeekday(WD[m[1]]);
  }

  // "в 9:30", "в 9 30", "в 21 час", "в 7 утра", "к 8 вечера"
  if ((m = cut(/\s(?:в|к|на)\s+(\d{1,2})(?:[:.\s](\d{2}))?(?:\s+час(?:а|ов)?)?(?:\s+(\d{2})\s+минут\S*)?(?:\s+(утра|дня|вечера|ночи))?\s/))) {
    let h = +m[1]; const mm = +(m[2] || m[3] || 0), part = m[4];
    if (h > 23 || mm > 59) return null;
    if ((part === "вечера" || part === "дня") && h < 12) h += 12;
    if (part === "ночи" && h === 12) h = 0;
    // "в 8" said at 15:00 means 20:00 today, not 8:00 tomorrow (an alarm stays in the morning)
    if (!part && !alarm && h >= 1 && h <= 11 && !date && !repeat && h * 60 + mm <= nowMin() && (h + 12) * 60 + mm > nowMin()) h += 12;
    time = pad2(h) + ":" + pad2(mm);
  } else {
    for (const [k, v] of Object.entries(PART_OF_DAY)) if (cut(new RegExp("\\s" + k + "\\s"))) { time = v; break; }
  }
  if (!date && !time && !repeat) return null;
  return finishWhen(s, date, time, repeat);
}
function finishWhen(rest, date, time, repeat) {
  let text = rest.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  // "напомни мне, что надо позвонить" → "позвонить"
  for (let i = 0; i < 5; i++) text = text.replace(/^(?:,\s*|(?:мне|нам|что(?:бы)?|о том,?\s*что(?:бы)?|про|о|об|надо|нужно|не забыть),?(?:\s+|$))/, "");
  return { date, time, repeat, text };
}

// ---------- the skills ----------
const REPEAT_SAY = { daily: "каждый день", weekdays: "по будням", weekends: "по выходным", weekly: "каждую неделю" };
const WD_ACC = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
function dayWords(date) {   // "сегодня", "завтра", "в субботу" within a week, otherwise "31 октября"
  if (date === today()) return "сегодня";
  if (date === addDays(1)) return "завтра";
  if (date === addDays(2)) return "послезавтра";
  const d = new Date(date + "T12:00");
  return (d - new Date()) / 864e5 < 6.5 ? WD_ACC[d.getDay()] : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}
function whenWords(t) {
  const at = t.time ? " в " + t.time.replace(/^0(?=\d:)/, "") : "";   // "в 9:00", not "в 09:00"
  if (t.repeat !== "none") return (t.repeat === "weekly" ? "каждую неделю " + WD_ACC[new Date(t.date + "T12:00").getDay()] : REPEAT_SAY[t.repeat]) + at;
  return dayWords(t.date) + at;
}
// the task text as it was said, with its capital letters ("позвонить Ане"), when it can be found
function asSaid(text, low) { const i = text.toLowerCase().lastIndexOf(low); return i >= 0 ? text.slice(i, i + low.length) : low; }
// people in the family: "напомни Пете…" is for someone else, which the AI handles (it knows who is who)
function startsWithMember(text) {
  const first = (/^([а-яё]+)/i.exec(text) || [])[1];
  return !!first && typeof family !== "undefined" && family.some(m => String(m.name || "").toLowerCase().startsWith(first.toLowerCase().slice(0, 3)) && first.length > 2 && /^[А-ЯЁ]/.test(text));
}

function localSkill(text, low) {
  // an alarm: "разбуди меня в 7", "поставь будильник на 6:30 по будням"
  let m = /^(?:разбуди(?:те)?(?:\s+меня)?|поставь(?:\s+мне)?\s+будильник|заведи(?:\s+мне)?\s+будильник|будильник)\s+(.+)$/.exec(low);
  if (m) {
    const w = parseWhen(m[1], { alarm: true });
    if (!w || !w.time) return false;
    const before = tasks.length;
    if (!addTask({ text: "Подъём", date: w.date || today(), time: w.time, repeat: w.repeat || undefined, alarm: true }, true) || tasks.length === before) return false;
    sayLocal(text, `Будильник ${whenWords(tasks[tasks.length - 1])}.`);
    return true;
  }
  // a reminder: "напомни завтра в 9 позвонить маме", "напомни через 20 минут выключить духовку"
  // not "запиши": that is also how medicines are dictated, and those belong to the medicine list
  m = /^(?:напомни(?:те)?|не дай(?:те)? (?:мне )?забыть|поставь напоминание)[,:]?\s+(.+)$/.exec(low);
  if (m) {
    const orig = text.replace(/^\S+(?:\s+(?:мне|напоминание|забыть))?[,:]?\s+/i, "");
    if (startsWithMember(orig) || /лекарств|таблетк|капл|укол|витамин/.test(low) || /^(что|какие|когда|сколько)(?=\s|$)/.test(m[1])) return false;
    const w = parseWhen(m[1]);
    if (!w || w.text.length < 3) return false;
    const before = tasks.length, said = asSaid(text, w.text);
    const txt = said[0].toUpperCase() + said.slice(1);
    // "напомни мне" belongs to whoever the camera sees speaking: it is said to them, not to the whole room
    const who = /(^|\s)мне(\s|,|$)/.test(m[1]) && typeof fam !== "undefined" ? fam.speakerId() : null;
    if (!addTask({ text: txt, date: w.date || today(), time: w.time, repeat: w.repeat || undefined, who }, true) || tasks.length === before) return false;
    sayLocal(text, `${g("Записал", "Записала")}: ${whenWords(tasks[tasks.length - 1])} — ${said}.`);
    return true;
  }
  return false;
}
