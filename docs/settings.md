# Settings

[← Overview](../README.md) · [Installation](install.md) · [Features](features.md) · [Privacy](privacy.md) · [Build](build.md) · [Русский](ru/settings.md)

Open Settings with the gear icon at the top right. After making changes, tap **«Сохранить»** (Save). Labels are shown in Russian as they appear in the app, with an English translation.

## Keys and AI

| Setting | What it does | Default |
|---|---|---|
| **«Ключ Gemini API»** (Gemini API key) | Main "brain", live voice, Google Search. Free: aistudio.google.com → Get API key. Stored only on the tablet | empty |
| **«Запасной мозг»** (Backup brain) | Who answers when Google's limit runs out: Groq, OpenRouter or Mistral | Groq |
| **«Ключ запасного мозга»** (Backup brain key) | Key for the chosen provider (optional). Without a Gemini key, the assistant runs on this one alone | empty |

## Voice and speech

| Setting | What it does | Default |
|---|---|---|
| **«Имя помощника»** (Assistant's name) | The word it responds to | «Помощник» |
| **«Ваш город»** (Your city) | Weather, morning briefing, timing of the light/dark theme switch | empty |
| **«Отвечать голосом»** (Answer by voice) | Turn off for text-only answers | on |
| **«Живой голос Gemini»** (Live Gemini voice) | Natural-sounding voice. When its limit runs out, the tablet's voice is used | on |
| **«Тембр живого голоса»** (Live voice timbre) | Calm, bright, soft (female); upbeat, low, energetic (male) | Calm, female |
| **«Голос планшета»** (Tablet voice) | Voice used when the live one isn't available. Plays a sample when selected | best Russian voice on the device |
| **«Можно перебивать голосом»** (Allow voice interruptions) | Lets you interrupt the assistant by voice while it speaks. Its voice then sounds quieter and muffled, like a phone call | off |
| **«Звуки интерфейса»** (Interface sounds) | Short beeps. Alarms always ring | on |

## Hearing, camera and behaviour

| Setting | What it does | Default |
|---|---|---|
| **«Слушать комнату»** (Listen to the room) | Listens continuously and tells apart requests to it from people talking among themselves. Same as the «Слух» (Hearing) button | on |
| **«Подсказывать по камере»** (Camera hints) | Speaks up by itself, only when it's useful | on |
| **«Разговорчивость»** (Talkativeness) | How often it speaks unprompted: Quiet (every 60 min), Normal (20 min), Active (7 min) | Normal |
| **«Тихие часы»** (Quiet hours) | Doesn't start talking by itself; reminders appear on screen only. Alarms still ring | 22:00–08:00 |
| **«Экран покоя»** (Idle screen) | Minutes without touch before showing the clock and weather (0 turns it off) | 3 |
| **«Окошко камеры»** (Camera window) | Small circle in the corner showing that the camera is watching | on |
| **«Оформление»** (Look) | «Минимализм» (Minimal: light by day, dark after sunset) or «Студия» (Studio) | Minimal |

## Phone link

| Setting | What it does | Default |
|---|---|---|
| **«Токен бота от @BotFather»** (Bot token from @BotFather) | Telegram bot for the phone link. Changing the token unlinks the phone | empty |
| **«Привязать» / «Отвязать»** (Link / Unlink) | Links your phone: after tapping, message the bot within 2 minutes | — |
| **«Сигнал о пропущенном лекарстве»** (Missed medication alert) | Minutes after the dose time before notifying the phone (10–240) | 30 |

## System

| Setting | What it does | Default |
|---|---|---|
| **«Запускаться при включении планшета»** (Start when the tablet turns on) | Autostart and restart after a crash. Needs the Android "Display over other apps" permission ([how to grant](install.md#9-autostart-and-restart-after-a-crash)) | on |
| **«Пауза между взглядами»** (Pause between looks) | Minimum seconds between automatic camera looks (at least 10) | 60 |
| **«Чувствительность движения»** (Motion sensitivity) | Percentage of the frame that must change (1–50). Lower is more sensitive | 6 |
| **«Лимит в день»** (Daily limit) | Maximum automatic camera looks sent to the AI per day (0–1500) | 300 |

## Family, memory, log

| Section | What you can do |
|---|---|
| **«Семья»** (Family) | List of people: role, «ты» or «вы», age, number of face samples. «Лицо» (Face) retakes the face, the bin deletes the person, «Познакомиться» (Get acquainted) adds someone |
| **«Память»** (Memory) | Facts the assistant has remembered. Any of them can be deleted |
| **«Стереть разговор и журнал камеры»** (Erase conversation and camera log) | Clears recent lines of conversation and camera observations |
| **Statistics** | Today's AI requests, phrases spoken with the live voice, number of models available |
