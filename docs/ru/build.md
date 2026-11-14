# Сборка из исходников

[← К описанию](../../README.ru.md) · [Установка](install.md) · [Функции](features.md) · [Настройки](settings.md) · [Приватность](privacy.md) · [English](../build.md)

Приложение — это веб-страница (`приложение/`), которую показывает Android-оболочка (`android-app/`) во встроенном браузере WebView. Оболочка добавляет распознавание и синтез речи, радио, автозапуск и сторож зависаний.

## Структура

| Путь | Что внутри |
|---|---|
| `приложение/index.html` | Разметка, стили, настройки |
| `приложение/app.js` | Ядро: речь, слух, ИИ, дела, покупки, таймеры, погода, Telegram, радио |
| `приложение/ui.js` | Виджеты, экран покоя, смена темы |
| `приложение/family.js` | Узнавание лиц и знакомство |
| `приложение/meds.js` | Лекарства |
| `приложение/skills.js` | Напоминания и будильники без ИИ |
| `приложение/search.js` | Поиск, курсы, новости, Википедия |
| `приложение/kitchen.js` | Продукты и сроки годности |
| `приложение/recipes.js`, `mycook.js` | Рецепты из интернета и свои |
| `приложение/selftest.js` | Самопроверка |
| `приложение/core.js`, `minimal.css` | Анимация «ядра», оформление «Минимализм» |
| `приложение/models/`, `vendor/` | Модели и библиотека [face-api.js](https://github.com/vladmandic/face-api) (лицензия MIT, см. `vendor/face-api.LICENSE.txt`) |
| `android-app/` | Java-оболочка: `MainActivity.java`, `BootReceiver.java`, манифест, иконки |
| `build.ps1` | Сборка подписанного APK без Gradle |

## Вариант 1: скрипт `build.ps1` (Windows, без Gradle)

Нужно:

- **Android SDK** с `build-tools/34.0.0` и `platforms/android-34` в `%LOCALAPPDATA%\Android\Sdk`;
- **JDK 17**, распакованный в папку `tools/jdk-17…` рядом со скриптом (например, Eclipse Temurin 17 с adoptium.net);
- **ключ подписи** `ключ/pomoshnik-release.jks` с паролем в `ключ/пароль.txt`.

Создать свой ключ:

```
mkdir ключ
tools\jdk-17*\bin\keytool -genkeypair -keystore ключ\pomoshnik-release.jks -storetype PKCS12 -alias pomoshnik -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Pomoshnik"
```

Запишите пароль в `ключ\пароль.txt` (одна строка), затем:

```
powershell -ExecutionPolicy Bypass -File build.ps1
```

Готовый APK: `Pomoshnik-1.0-release.apk`.

Версию меняют в начале `build.ps1` (`$versionCode`, `$versionName`). Чтобы APK ставился поверх установленного, `$versionCode` должен расти, а ключ подписи — оставаться тем же.

> **Ключ и пароль никогда не кладите в репозиторий** (они уже в `.gitignore`). Если ключ потерян, выпустить обновление, которое встанет поверх старой версии, невозможно.

## Вариант 2: Gradle / Android Studio

Нужно: JDK 17, Gradle 8.7, Android SDK 34.

```
gradle -p android-app assembleRelease
```

Страница помощника берётся прямо из `приложение/` (`assets.srcDirs` в `android-app/app/build.gradle`). Для релиза добавьте в `build.gradle` свой `signingConfig`: сейчас там стоит отладочная подпись.

## Запуск в браузере

Страница работает и в обычном Chrome, с упрощениями: голос и распознавание браузера, без автозапуска. Камере нужен `https://` или `localhost`:

```
cd приложение
python -m http.server 8000
```

Откройте `http://localhost:8000`.

## Проверка после изменений

Установите APK и скажите «Помощник, проверь себя». Это 32 проверки на тестовых данных, ваши данные не меняются. После обновления APK самопроверка запускается сама.
