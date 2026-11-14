# Building from source

[← Overview](../README.md) · [Installation](install.md) · [Features](features.md) · [Settings](settings.md) · [Privacy](privacy.md) · [Русский](ru/build.md)

The app is a web page (`приложение/`, Russian for "app") displayed by an Android shell (`android-app/`) in a WebView. The shell adds speech recognition and synthesis, radio playback, autostart and a hang watchdog.

## Layout

| Path | Contents |
|---|---|
| `приложение/index.html` | Markup, styles, settings sheet |
| `приложение/app.js` | Core: speech, hearing, AI, tasks, shopping, timers, weather, Telegram, radio |
| `приложение/ui.js` | Widgets, idle screen, theme switching |
| `приложение/family.js` | Face recognition and getting acquainted |
| `приложение/meds.js` | Medications |
| `приложение/skills.js` | Reminders and alarms without AI |
| `приложение/search.js` | Search, exchange rates, news, Wikipedia |
| `приложение/kitchen.js` | Pantry and use-by dates |
| `приложение/recipes.js`, `mycook.js` | Internet recipes and your own |
| `приложение/selftest.js` | Self-test |
| `приложение/core.js`, `minimal.css` | Animated "core", Minimal look |
| `приложение/models/`, `vendor/` | Models and the [face-api.js](https://github.com/vladmandic/face-api) library (MIT License, see `vendor/face-api.LICENSE.txt`) |
| `android-app/` | Java shell: `MainActivity.java`, `BootReceiver.java`, manifest, icons |
| `build.ps1` | Builds a signed APK without Gradle |

## Option 1: `build.ps1` (Windows, no Gradle)

You need:

- **Android SDK** with `build-tools/34.0.0` and `platforms/android-34` in `%LOCALAPPDATA%\Android\Sdk`;
- **JDK 17** unpacked into a `tools/jdk-17…` folder next to the script (for example Eclipse Temurin 17 from adoptium.net);
- **a signing key** at `ключ/pomoshnik-release.jks` (`ключ` is Russian for "key"), with its password in `ключ/пароль.txt` ("password").

Create your own key:

```
mkdir ключ
tools\jdk-17*\bin\keytool -genkeypair -keystore ключ\pomoshnik-release.jks -storetype PKCS12 -alias pomoshnik -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Pomoshnik"
```

Put the password in `ключ\пароль.txt` (one line), then run:

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

Output: `Pomoshnik-1.0-release.apk`.

The version is set at the top of `build.ps1` (`$versionCode`, `$versionName`). For an APK to install over an existing one, `$versionCode` must increase and the signing key must stay the same.

> **Never commit the key or its password** (both are already in `.gitignore`). If the key is lost, you can't publish an update that installs over the old version.

## Option 2: Gradle / Android Studio

You need JDK 17, Gradle 8.7 and Android SDK 34.

```
gradle -p android-app assembleRelease
```

The assistant's page is taken directly from `приложение/` (`assets.srcDirs` in `android-app/app/build.gradle`). For a release build, add your own `signingConfig` to `build.gradle`: it currently uses the debug signature.

## Running in a browser

The page also works in desktop Chrome, with simplifications: the browser's own voice and speech recognition, no autostart. The camera needs `https://` or `localhost`:

```
cd приложение
python -m http.server 8000
```

Open `http://localhost:8000`.

## Testing after changes

Install the APK and say «Помощник, проверь себя» ("check yourself"). It runs 32 checks on test data; your data is not changed. After an APK update the self-test runs by itself.
