"use strict";
// ---------- medicines: a schedule, spoken reminders, "taken" marks, and a signal to the phone when a dose is missed ----------
// Doses are planned slots ("<medId>@HH:MM") for a day; the log keeps what happened to each one.
let meds = store.get("meds", []);        // [{id, name, dose, times:["08:00"], repeat, weekday, food, who, stock, until}]
let medLog = store.get("medlog", {});    // {"YYYY-MM-DD": {"<medId>@HH:MM": {s:"taken"|"skipped", at, n, last, snooze, alerted}}}
let medAwaitUntil = 0;                   // after a reminder, a bare "готово" or "да" means the medicine
const FOOD = { before: "до еды", after: "после еды", with: "во время еды" };
const REPEAT_MED = { daily: "каждый день", weekdays: "по будням", weekends: "по выходным", weekly: "раз в неделю" };

function saveMeds() {
  const keep = addDays(-14);
  for (const d of Object.keys(medLog)) if (d < keep) delete medLog[d];
  store.set("meds", meds); store.set("medlog", medLog);
  renderMeds(); renderNow();
}
function medLabel(m) { return m.name + (m.dose ? " " + m.dose : ""); }
// in a sentence: "пора принять аспирин", but "витамин D" and "АЦЦ" keep their capitals
function spoken(name) { return /^[A-ZА-ЯЁ]{2}/.test(name) ? name : name[0].toLowerCase() + name.slice(1); }
function agoText(min) { const h = Math.floor(min / 60), m = min % 60; return h ? `${h} ч${m ? " " + m + " мин" : ""}` : `${m} мин`; }
function medOn(m, date) {
  if (m.until && date > m.until) return false;
  if (m.from && date < m.from) return false;
  return !m.repeat || m.repeat === "daily" || matchesRepeat(m, new Date(date + "T12:00"));
}
function dosesOn(date) {
  const out = [];
  for (const m of meds) if (medOn(m, date)) for (const t of m.times) {
    if (m.addedDay === date && toMin(t) < m.addedMin) continue;   // already past when it was written down
    out.push({ key: m.id + "@" + t, med: m, time: t });
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name));
}
function doseEntry(date, key, create) {
  if (!medLog[date]) { if (!create) return {}; medLog[date] = {}; }
  if (!medLog[date][key]) { if (!create) return {}; medLog[date][key] = {}; }
  return medLog[date][key];
}
// due now and not yet taken or skipped; "early" lets a dose be marked up to an hour before its time
function pendingDoses(early = 0) {
  const td = today(), n = nowMin();
  return dosesOn(td).filter(d => !doseEntry(td, d.key).s && toMin(d.time) <= n + early && n - toMin(d.time) <= 180);
}
function doseState(date, d) {
  const e = doseEntry(date, d.key);
  if (e.s) return e.s;
  if (date < today()) return "missed";
  const late = nowMin() - toMin(d.time);
  return late < 0 ? "later" : late >= (cfg.medMiss || 30) ? "missed" : "due";
}

// ---------- adding and removing ----------
function addMed(spec, quiet) {
  const name = String(spec?.name || "").trim().slice(0, 60);
  const times = [...new Set((Array.isArray(spec?.times) ? spec.times : [spec?.times]).map(normTime).filter(Boolean))].sort();
  if (!name || !times.length) return null;
  const repeat = REPEATS.includes(spec.repeat) ? spec.repeat : "daily";
  const m = {
    id: Math.random().toString(36).slice(2, 8), name: name[0].toUpperCase() + name.slice(1), dose: String(spec.dose || "").trim().slice(0, 40),
    times, repeat, food: FOOD[spec.food] ? spec.food : null, who: spec.who || null, from: today(), addedDay: today(), addedMin: nowMin(),
    stock: spec.stock > 0 ? Math.round(+spec.stock) : null, until: spec.days > 0 ? addDays(Math.round(+spec.days) - 1) : null,
  };
  if (repeat === "weekly") m.weekday = new Date().getDay();
  // the same medicine again replaces the old schedule instead of doubling it
  const same = meds.find(x => x.name.toLowerCase() === m.name.toLowerCase() && (x.who || null) === m.who);
  if (same) Object.assign(same, m, { id: same.id }); else meds.push(m);
  saveMeds();
  if (!quiet) toast("Лекарство: " + medLabel(m), "pill");
  return same || m;
}
function findMeds(q) {
  q = String(q || "").toLowerCase().trim();
  if (!q) return [];
  const byId = meds.filter(m => m.id === q);
  return byId.length ? byId : meds.filter(m => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()));
}
function removeMed(q) {
  const hit = findMeds(q); if (!hit.length) return false;
  meds = meds.filter(m => !hit.includes(m)); saveMeds();
  return true;
}

// ---------- marking doses ----------
// status: "taken" | "skipped"; which: medicine name or "all"; the speaker's own doses first when known
function markDoses(status, which, early = 60) {
  let list = pendingDoses(early);
  const w = String(which || "").toLowerCase().trim();
  if (w && w !== "all" && w !== "все") list = list.filter(d => d.med.name.toLowerCase().includes(w) || w.includes(d.med.name.toLowerCase()));
  const me = fam.speakerId();
  if (me && list.some(d => d.med.who === me)) list = list.filter(d => d.med.who === me || !d.med.who);
  const td = today(), notes = [];
  for (const d of list) {
    const e = doseEntry(td, d.key, true);
    e.s = status; e.at = Date.now();
    if (status === "taken" && d.med.stock != null) {
      d.med.stock = Math.max(0, d.med.stock - 1);
      // running low: about three days left goes on the shopping list once
      if (d.med.stock <= d.med.times.length * 3 && !d.med.lowNoted) {
        d.med.lowNoted = true;
        if (shopAdd(d.med.name)) { saveShop(); notes.push(`${d.med.name} заканчивается — ${g("добавил", "добавила")} в покупки`); }
      }
    }
    if (status === "skipped" && cfg.tgChat) {
      const to = d.med.who ? fam.name(d.med.who) : null;
      tgSend(`💊 ${to ? to + ": п" : "П"}ропуск приёма — ${medLabel(d.med)} (${d.time}). Так сказали дома.`).catch(() => {});
    }
  }
  if (list.length) { medAwaitUntil = 0; tone(SND.done); saveMeds(); }
  return { list, notes };
}
function namesOf(list) {
  const n = [...new Set(list.map(d => spoken(d.med.name)))];
  return n.length > 1 ? n.slice(0, -1).join(", ") + " и " + n[n.length - 1] : n[0] || "";
}

// ---------- what the person says back ----------
const MED_TAKEN = /^(я |мы |он |она )?(уже |все |всё |только что )?(выпил|выпила|выпили|принял|приняла|приняли)|(выпил|выпила|выпили|принял|приняла|приняли)\s+(\S+\s+)?(таблет|лекарств|витамин|капл|пилюл)/;
const MED_YES = /^(готово|сделано|да|ага|угу|есть)[.!]?$/;
const MED_SKIP = /(пропущу|пропусти|пропускаю|не буду (пить|принимать)|сегодня не буду)/;
const MED_LATER = /^(позже|потом|попозже|чуть позже|напомни позже|через (\d+|пять|десять|пятнадцать|двадцать|полчаса)( мин\S*)?)/;
function medWords(low) { return /(таблет|лекарств|витамин|капл|пилюл|укол)/.test(low) || meds.some(m => low.includes(m.name.toLowerCase())); }
function medAwaiting() { return Date.now() < medAwaitUntil && pendingDoses().length > 0; }
// does the room's phrase answer a medicine reminder? (heard without the assistant's name)
function medHeard(low) {
  if (!meds.length) return false;
  return (medAwaiting() && (MED_TAKEN.test(low) || MED_YES.test(low) || MED_SKIP.test(low) || MED_LATER.test(low)))
    || (MED_TAKEN.test(low) && medWords(low) && pendingDoses(60).length > 0);
}
// handled here without the AI; false lets the brain answer
function medReply(text, low) {
  if (!meds.length) return false;
  const waiting = medAwaiting();
  if (MED_SKIP.test(low) && (waiting || medWords(low))) {
    const r = markDoses("skipped", ""); if (!r.list.length) return false;
    remember("user", text); speak(`${g("Отметил", "Отметила")} пропуск: ${namesOf(r.list)}.`); return true;
  }
  if (waiting && MED_LATER.test(low)) {
    const n = +((/(\d+)/.exec(low) || [])[1]) || (/полчаса/.test(low) ? 30 : /двадцать/.test(low) ? 20 : /пять(?![а-яё])/.test(low) ? 5 : /десять/.test(low) ? 10 : 15);
    const td = today();
    for (const d of pendingDoses()) doseEntry(td, d.key, true).snooze = Date.now() + n * 60000;
    medAwaitUntil = 0; saveMeds(); remember("user", text);
    speak(`Хорошо, напомню через ${n} ${plural(n, "минуту", "минуты", "минут")}.`); return true;
  }
  if ((MED_TAKEN.test(low) && (waiting || medWords(low))) || (waiting && MED_YES.test(low))) {
    const name = (/(выпил|выпила|выпили|принял|приняла|приняли)\s+(.+)$/.exec(low) || [])[2] || "";
    // "выпила аспирин" names one medicine; "выпила таблетки" means everything due
    const which = /(таблет|лекарств|вс[её])/.test(name) ? "" : name.replace(/[.!?]/g, "").trim();
    let r = markDoses("taken", which);
    if (!r.list.length && which) r = markDoses("taken", "");
    if (!r.list.length) return false;
    remember("user", text);
    speak(`${g("Отметил", "Отметила")}: ${namesOf(r.list)} — ${new Set(r.list.map(d => d.med.id)).size > 1 ? "приняты" : "принят"}.${r.notes.length ? " " + r.notes.join(". ") + "." : ""}`);
    return true;
  }
  return false;
}

// ---------- reminders, repeated, then a signal to the phone ----------
function checkMeds() {
  if (!meds.length) return;
  const td = today(), n = nowMin(), now = Date.now(), ready = [];
  let dirty = false;
  for (const d of dosesOn(td)) {
    const e = doseEntry(td, d.key);
    if (e.s) continue;
    const late = n - toMin(d.time);
    if (late < 0) continue;
    // not marked for too long: the family's phone hears about it once
    if (late >= (cfg.medMiss || 30) && !e.alerted) {
      const en = doseEntry(td, d.key, true); en.alerted = true; dirty = true;
      if (cfg.tgChat) {
        const to = d.med.who ? fam.name(d.med.who) : null;
        tgSend(`💊 Не отмечен приём лекарства${to ? " (" + to + ")" : ""}: ${medLabel(d.med)} в ${d.time}. Прошло ${agoText(late)}. Позвоните домой, чтобы уточнить.`)
          .catch(() => { en.alerted = false; });
      }
    }
    if (late > 180 || (e.n | 0) >= 3) continue;                      // too late to keep nagging aloud
    if (e.snooze > now) continue;
    if (e.n && now - (e.last || 0) < 10 * 60000 && !(e.snooze && e.snooze <= now)) continue;
    if (d.med.who && !fam.canDeliver(d.med.who)) continue;           // a personal medicine waits for its person
    ready.push(d);
  }
  if (dirty) saveMeds();
  if (!ready.length || speaking || busy || ringing || listeningOnce || onboarding || fam.guestOnly()) return;
  // one reminder for everything due for the same person
  const who = ready[0].med.who || null, group = ready.filter(d => (d.med.who || null) === who);
  const again = group.some(d => doseEntry(td, d.key).n);
  for (const d of group) { const e = doseEntry(td, d.key, true); e.n = (e.n | 0) + 1; e.last = now; e.snooze = 0; }
  saveMeds();
  const to = who ? fam.name(who) : null;
  const what = group.map(d => spoken(medLabel(d.med))).join(", ");
  const foods = [...new Set(group.map(d => d.med.food).filter(Boolean))];
  const msg = `${to ? to + ", " : ""}${again ? "напоминаю ещё раз: " : ""}пора принять ${what}${foods.length === 1 ? ", " + FOOD[foods[0]] : ""}. Скажите «готово», когда примете.`;
  medAwaitUntil = now + 20 * 60000;
  followupUntil = now + 40000; followExpect = true;
  remember("assistant", msg);
  tone(SND.chime);
  setTimeout(() => speak(msg[0].toUpperCase() + msg.slice(1)), 700);
}
setInterval(checkMeds, 20000);

// ---------- for the brain, the phone and the "now" tile ----------
function medsPrompt() {
  if (!meds.length) return "Лекарства по расписанию: не записаны.";
  const td = today();
  const st = { taken: "принято", skipped: "пропущено", missed: "НЕ отмечено", due: "пора принять", later: "ещё не время" };
  return "Лекарства по расписанию [id] (сегодня):\n" + meds.map(m => {
    const today_ = medOn(m, td) ? m.times.map(t => {
      const d = { key: m.id + "@" + t, med: m, time: t }, e = doseEntry(td, d.key);
      return `${t} ${st[doseState(td, d)]}${e.at ? " в " + hm(new Date(e.at)) : ""}`;
    }).join(", ") : "сегодня не по расписанию";
    return `- [${m.id}] ${medLabel(m)}, ${REPEAT_MED[m.repeat] || "каждый день"} в ${m.times.join(", ")}${m.food ? ", " + FOOD[m.food] : ""}${m.who && fam.name(m.who) ? ", для " + fam.name(m.who) : ""}${m.stock != null ? ", осталось " + m.stock + " шт" : ""}${m.until ? ", курс до " + m.until : ""}; сегодня: ${today_}`;
  }).join("\n");
}
function medsText() {
  if (!meds.length) return "💊 Лекарства не записаны.";
  const td = today(), mark = { taken: "✅", skipped: "⏭", missed: "❗", due: "⏰", later: "•" };
  const rows = dosesOn(td).map(d => `${mark[doseState(td, d)]} ${d.time} ${medLabel(d.med)}${d.med.who && fam.name(d.med.who) ? " — " + fam.name(d.med.who) : ""}`);
  return "💊 Лекарства сегодня:\n" + (rows.join("\n") || "по расписанию ничего");
}
function medNow() {
  const d = pendingDoses().filter(x => nowMin() - toMin(x.time) <= 180)[0];
  if (!d) return null;
  const to = d.med.who ? fam.name(d.med.who) : null;
  return { title: (to ? to + ": " : "") + medLabel(d.med), sub: `Приём на ${d.time}${d.med.food ? ", " + FOOD[d.med.food] : ""} — скажите «готово», когда примете` };
}
// actions the brain asked for; failures are reported back so the reply never claims them
function applyMeds(o, fails) {
  let changed = false;
  const list = (x) => Array.isArray(x) ? x : x ? [x] : [];
  for (const s of list(o.meds_add)) {
    if (addMed({ ...s, who: fam.idByName(s?.who) }, true)) changed = true; else fails.push("записать лекарство — не поняла время приёма".replace("поняла", g("понял", "поняла")));
  }
  for (const q of list(o.meds_taken)) { if (markDoses("taken", typeof q === "string" ? q : q?.name || "", 120).list.length) changed = true; else fails.push("найти приём, который пора отметить"); }
  for (const q of list(o.meds_skip)) { if (markDoses("skipped", typeof q === "string" ? q : q?.name || "", 120).list.length) changed = true; }
  for (const q of list(o.meds_remove)) { if (removeMed(q)) changed = true; else fails.push("найти это лекарство"); }
  return changed;
}

// ---------- the "Лекарства" tab ----------
function renderMeds() {
  const ul = $("meds"); ul.textContent = "";
  const td = today(), doses = dosesOn(td);
  const head = (t) => { const li = document.createElement("li"); li.className = "ghead"; li.textContent = t; ul.append(li); };
  const STATUS = { taken: "принято", skipped: "пропуск", missed: "пропущено", due: "пора", later: "" };
  if (doses.length) head("Сегодня");
  for (const d of doses) {
    const st = doseState(td, d), e = doseEntry(td, d.key);
    const li = document.createElement("li");
    li.className = ["dose", st === "taken" && "done", st === "skipped" && "skipped", (st === "due" || st === "missed") && "due"].filter(Boolean).join(" ");
    li.innerHTML = `<button class="tick press" aria-label="${st === "taken" ? "Отменить отметку" : "Принято"}">${icon("check")}</button>
      <span class="when">${d.time}</span><span class="txt"><span class="nm"></span><small></small></span><span class="st"></span>`;
    li.querySelector(".nm").textContent = medLabel(d.med);
    li.querySelector("small").textContent = [d.med.food && FOOD[d.med.food], d.med.who && fam.name(d.med.who), e.at && (st === "taken" ? "в " + hm(new Date(e.at)) : "")].filter(Boolean).join(" · ");
    li.querySelector(".st").textContent = STATUS[st] || "";
    li.querySelector(".tick").onclick = () => {
      haptic(12);
      const en = doseEntry(td, d.key, true);
      if (en.s === "taken") { delete en.s; delete en.at; if (d.med.stock != null) d.med.stock++; }
      else { en.s = "taken"; en.at = Date.now(); if (d.med.stock != null) d.med.stock = Math.max(0, d.med.stock - 1); tone(SND.done); }
      saveMeds();
    };
    ul.append(li);
  }
  head("Курс");
  for (const m of meds) {
    const li = document.createElement("li"); li.className = "course";
    li.innerHTML = `<span class="pillIco">${icon("pill")}</span><span class="txt"><span class="nm"></span><small></small></span><button class="del press" aria-label="Удалить">${icon("trash")}</button>`;
    li.querySelector(".nm").textContent = medLabel(m);
    li.querySelector("small").textContent = [`${REPEAT_MED[m.repeat] || "каждый день"} в ${m.times.join(", ")}`, m.food && FOOD[m.food], m.who && fam.name(m.who),
      m.stock != null && `осталось ${m.stock} шт`, m.until && `до ${dayLabel(m.until).toLowerCase()}`].filter(Boolean).join(" · ");
    li.querySelector(".del").onclick = () => { haptic(); li.classList.add("leave"); setTimeout(() => { meds = meds.filter(x => x !== m); saveMeds(); }, reduceMotion ? 0 : 280); };
    ul.append(li);
  }
  const left = doses.filter(d => ["due", "missed"].includes(doseState(td, d))).length;
  $("cntMeds").textContent = left ? String(left) : "";
  renderTab();
}

// ---------- the add form ----------
$("medAdd").onclick = () => {
  haptic();
  for (const id of ["medName", "medDose", "medTimes", "medStock", "medDays"]) $(id).value = "";
  $("medRepeat").value = "daily"; $("medFood").value = "";
  const who = $("medWho"); who.innerHTML = `<option value="">Не важно</option>`;
  for (const m of (typeof family !== "undefined" ? family : [])) { const o = document.createElement("option"); o.value = m.id; o.textContent = m.name; who.append(o); }
  openSheet($("medSheet")); setTimeout(() => $("medName").focus(), 350);
};
$("medSave").onclick = () => {
  const times = $("medTimes").value.split(/[,;\s]+/).filter(Boolean);
  const m = addMed({ name: $("medName").value, dose: $("medDose").value, times, repeat: $("medRepeat").value, food: $("medFood").value || null,
    who: $("medWho").value || null, stock: +$("medStock").value || null, days: +$("medDays").value || null });
  if (!m) { toast("Нужны название и время приёма, например 08:00, 20:00", "pill"); return; }
  haptic(12); closeSheet(); setTab("meds");
};
$("tabMeds").onclick = () => { haptic(); setTab("meds"); renderMeds(); };
setInterval(() => { if (tab === "meds") renderMeds(); }, 60000);
renderMeds(); renderNow();
