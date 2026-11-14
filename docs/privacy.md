# Privacy: what is stored where

[← Overview](../README.md) · [Installation](install.md) · [Features](features.md) · [Settings](settings.md) · [Build](build.md) · [Русский](ru/privacy.md)

## In the APK and this repository

**Code only.** There are no keys, names, faces, tasks or medications in the APK or in this repository. Personal data only appears on the device as you use the app.

## On the tablet

Everything is kept in the app's private storage, which other apps can't access:

- Gemini and backup brain keys, the Telegram token;
- family: names, roles, ages, notes, numeric face "fingerprints" and small avatars;
- tasks, alarms, timers, shopping, medications and the dose log (14 days), pantry, recipes;
- remembered facts, the last 16 lines of conversation, the last 12 camera observations.

Android backup is **disabled** for the app: uninstalling it deletes the data completely, and nothing is copied to the cloud.

## What goes online

| Where | What | When |
|---|---|---|
| **Google Gemini** (or the backup brain: Groq / OpenRouter / Mistral) | Your phrase and context: family members' names and roles, who is present, tasks, shopping, medications, pantry, remembered facts, recent conversation, city | With every AI request |
| | **A camera frame** (640 px) | Only when it needs to "look": the «Посмотри» (Look) button, questions about what's visible, automatic hints, the morning briefing. Groq never receives frames |
| **Gemini (voice)** | The text of the phrase to be spoken | If "Live Gemini voice" is on |
| **Google speech recognition service on the tablet** | Speech audio | While the assistant is listening |
| **Telegram** | Shopping list, reminders, the name and dose of a missed medication, SOS alerts with the phrase heard and the last camera observation | Only if the bot is linked |
| Open-Meteo, Wikipedia, Google News, National Bank of Poland, open.er-api, 1000.menu, Radio Browser | Only the query itself: city, search topic, currency, dish, radio genre | On request |

**Never sent:** face images and face "fingerprints", avatars, passwords (the assistant refuses to remember them).

## How to delete data

- **One person**: «Помощник, забудь меня» ("forget me") or Settings → «Семья» (Family) → bin icon.
- **A remembered fact**: «Забудь про …» ("forget about …") or Settings → «Память» (Memory).
- **Conversation and camera log**: Settings → «Стереть разговор и журнал камеры» (Erase conversation and camera log).
- **Everything**: uninstall the app, or Android Settings → Apps → Помощник → Storage → Clear data.
