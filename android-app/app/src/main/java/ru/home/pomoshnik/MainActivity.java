package ru.home.pomoshnik;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.speech.tts.Voice;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native shell for the assistant: serves the bundled page from a secure https origin,
 * grants the camera to it, and provides Android speech recognition, text-to-speech
 * and vibration through the {@code AndroidBridge} JavaScript interface.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_PERMS = 1;
    // the only hosts the page may read through httpGet (open data sources that need no keys)
    private static final Set<String> HTTP_HOSTS = new HashSet<>(Arrays.asList(
            "api.open-meteo.com", "geocoding-api.open-meteo.com", "ru.wikipedia.org", "en.wikipedia.org", "news.google.com", "api.nbp.pl", "1000.menu", "api.duckduckgo.com", "api.telegram.org",
            "de1.api.radio-browser.info", "de2.api.radio-browser.info", "fi1.api.radio-browser.info"));
    static final String PREFS = "app";
    static final String PREF_AUTOSTART = "autostart";
    // streams the recognizer's start/stop beeps can play on
    private static final int[] BEEP_STREAMS = { AudioManager.STREAM_MUSIC, AudioManager.STREAM_SYSTEM, AudioManager.STREAM_NOTIFICATION };

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private boolean beepsMuted;
    private String voiceName = "";
    private WebView web;
    private TextToSpeech tts;
    private boolean ttsReady;
    private SpeechRecognizer recognizer;
    private PermissionRequest pendingWebRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        installCrashRestart();

        web = new WebView(this);
        web.setBackgroundColor(0xFFEEF0F7);
        setContentView(web);
        enterImmersive();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                main.post(() -> {
                    if (has(Manifest.permission.CAMERA)) grantToPage(request);
                    else { pendingWebRequest = request; askPermissions(); }
                });
            }
        });

        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) { tts.setLanguage(new Locale("ru", "RU")); pickBestVoice(); }
        });
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            // ids starting with "b" are silent voice benchmarks, never heard
            @Override public void onStart(String id) { if (!id.startsWith("b")) js("onSpeakStart", ""); }
            @Override public void onDone(String id) { if (id.startsWith("b")) benchDone(id, true); else js("onSpeakEnd", ""); }
            @Override public void onError(String id) { if (id.startsWith("b")) benchDone(id, false); else js("onSpeakEnd", ""); }
            @Override public void onAudioAvailable(String id, byte[] audio) {
                long[] t = bench.get(id);
                if (t != null && t[1] == 0) t[1] = System.currentTimeMillis();
            }
        });

        askPermissions();
        web.loadUrl(START_URL);
        lastPing = System.currentTimeMillis();
        main.postDelayed(watchdog, 30000);
    }

    // ---------- reliability: the page sends a heartbeat; a frozen page is reloaded ----------
    private volatile long lastPing;
    private boolean inFront = true;
    private final Runnable watchdog = new Runnable() {
        @Override public void run() {
            if (web != null && inFront && System.currentTimeMillis() - lastPing > 90000) {
                lastPing = System.currentTimeMillis();
                web.reload();
            }
            main.postDelayed(this, 30000);
        }
    };

    @Override
    protected void onResume() {
        super.onResume();
        inFront = true; lastPing = System.currentTimeMillis();   // timers were throttled in the background
    }

    // ---------- assets from a secure origin, so the page may use the camera ----------

    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            try {
                InputStream in = getAssets().open(path.substring(1));
                return new WebResourceResponse(mime(path), "utf-8", in);
            } catch (Exception e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null);
            }
        }

        // the page's renderer died (out of memory, WebView update): start over instead of crashing
        @Override
        public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
            main.post(MainActivity.this::recreate);
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
            return true;
        }
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    // ---------- permissions ----------

    private boolean has(String perm) {
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private void askPermissions() {
        List<String> need = new ArrayList<>();
        if (!has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
        if (!has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
        if (!need.isEmpty()) requestPermissions(need.toArray(new String[0]), REQ_PERMS);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        super.onRequestPermissionsResult(code, perms, results);
        if (pendingWebRequest != null) {
            if (has(Manifest.permission.CAMERA)) grantToPage(pendingWebRequest);
            else pendingWebRequest.deny();
            pendingWebRequest = null;
        }
        js("onPermissions", has(Manifest.permission.CAMERA) + "," + has(Manifest.permission.RECORD_AUDIO));
    }

    private void grantToPage(PermissionRequest request) {
        List<String> ok = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) ok.add(r);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) ok.add(r);
        }
        if (ok.isEmpty()) request.deny();
        else request.grant(ok.toArray(new String[0]));
    }

    // ---------- speech recognition ----------

    private void startListening() {
        if (!has(Manifest.permission.RECORD_AUDIO)) {
            askPermissions();
            js("onListenError", "no-permission");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            js("onListenError", "unavailable");
            return;
        }
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(this);
            recognizer.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { js("onListenStart", ""); }
                @Override public void onBeginningOfSpeech() { }
                @Override public void onRmsChanged(float rms) { }
                @Override public void onBufferReceived(byte[] buf) { }
                @Override public void onEndOfSpeech() { }
                @Override public void onError(int error) { js("onListenError", String.valueOf(error)); }
                // the other hypotheses and the confidence go first, so the page has them when the final text arrives
                @Override public void onResults(Bundle b) { js("onAlts", alternatives(b)); js("onFinal", first(b)); }
                @Override public void onPartialResults(Bundle b) { js("onPartial", first(b)); }
                @Override public void onEvent(int type, Bundle b) { }
            });
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        recognizer.startListening(i);
    }

    // "text|confidence" per line; confidence is -1 when the recognizer gives none
    private static String alternatives(Bundle b) {
        ArrayList<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        float[] conf = b == null ? null : b.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);
        StringBuilder sb = new StringBuilder();
        for (int k = 0; list != null && k < list.size(); k++)
            sb.append(list.get(k).replace('\n', ' ')).append('|').append(conf != null && k < conf.length ? conf[k] : -1f).append('\n');
        return sb.toString();
    }

    private static String first(Bundle b) {
        ArrayList<String> list = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() ? "" : list.get(0);
    }

    // ---------- reliability: reopen the assistant a moment after a crash ----------

    private void installCrashRestart() {
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                setBeepsMuted(false);
                android.app.AlarmManager am = getSystemService(android.app.AlarmManager.class);
                android.app.PendingIntent pi = android.app.PendingIntent.getActivity(this, 0,
                        new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_CANCEL_CURRENT);
                if (am != null) am.set(android.app.AlarmManager.RTC, System.currentTimeMillis() + 3000, pi);
            } catch (Exception ignored) { }
            if (previous != null) previous.uncaughtException(thread, error);
            else System.exit(2);
        });
    }

    // ---------- system voice: the most natural installed Russian voice (fallback for the Gemini voice) ----------

    private void pickBestVoice() {
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null) return;
            Voice best = null;
            for (Voice v : voices) {
                if (!"ru".equals(v.getLocale().getLanguage())) continue;
                if (v.getFeatures() != null && v.getFeatures().contains("notInstalled")) continue;
                if (best == null || v.getQuality() > best.getQuality()
                        || (v.getQuality() == best.getQuality() && v.isNetworkConnectionRequired() && !best.isNetworkConnectionRequired())) best = v;
            }
            if (best != null) { tts.setVoice(best); voiceName = best.getName(); }
        } catch (Exception ignored) { }
    }

    private Voice findVoice(String name) {
        try { for (Voice v : tts.getVoices()) if (v.getName().equals(name)) return v; } catch (Exception ignored) { }
        return null;
    }

    // silent benchmark: how long a voice takes to produce its first sound, synthesized to a file nobody hears
    private final java.util.concurrent.ConcurrentHashMap<String, long[]> bench = new java.util.concurrent.ConcurrentHashMap<>();
    private Voice benchPrev;
    private void benchVoice(String name) {
        Voice v = ttsReady ? findVoice(name) : null;
        if (v == null) { js("onBench", name + "|-1|-1"); return; }
        benchPrev = tts.getVoice();
        tts.setVoice(v);
        String id = "b" + name;
        bench.put(id, new long[] { System.currentTimeMillis(), 0 });
        int r = tts.synthesizeToFile("Хорошо, сейчас посмотрю, что у нас запланировано на завтра.", new Bundle(),
                new java.io.File(getCacheDir(), "bench.wav"), id);
        if (r != TextToSpeech.SUCCESS) benchDone(id, false);
    }
    private void benchDone(String id, boolean ok) {
        long[] t = bench.remove(id);
        main.post(() -> { if (benchPrev != null) { tts.setVoice(benchPrev); benchPrev = null; } });
        if (t == null) return;
        long now = System.currentTimeMillis();
        js("onBench", id.substring(1) + "|" + (ok && t[1] > 0 ? t[1] - t[0] : -1) + "|" + (ok ? now - t[0] : -1));
    }

    // ---------- recognizer beeps: muted while the assistant listens in the background ----------

    private void setBeepsMuted(boolean mute) {
        if (mute == beepsMuted) return;
        AudioManager am = getSystemService(AudioManager.class);
        if (am == null) return;
        for (int s : BEEP_STREAMS) {
            if (s == AudioManager.STREAM_MUSIC && musicOn) continue;   // the radio plays on this stream
            try { am.adjustStreamVolume(s, mute ? AudioManager.ADJUST_MUTE : AudioManager.ADJUST_UNMUTE, 0); } catch (Exception ignored) { }
        }
        beepsMuted = mute;
    }

    // the radio is playing: keep the music stream audible even while the recognizer listens
    private boolean musicOn = false;

    private void setMusicOn(boolean on) {
        if (on == musicOn) return;
        musicOn = on;
        AudioManager am = getSystemService(AudioManager.class);
        if (am == null || !beepsMuted) return;
        try { am.adjustStreamVolume(AudioManager.STREAM_MUSIC, on ? AudioManager.ADJUST_UNMUTE : AudioManager.ADJUST_MUTE, 0); } catch (Exception ignored) { }
    }

    // ---------- radio: a native player, because the WebView pauses its own media whenever the recognizer takes audio focus ----------
    private MediaPlayer player;
    private float musicVol = 0.6f;

    private void musicPlay(String url) {
        musicRelease();
        try {
            if (!url.startsWith("https://")) throw new Exception("https only");
            MediaPlayer p = new MediaPlayer();
            p.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            p.setDataSource(url);
            p.setVolume(musicVol, musicVol);
            p.setOnPreparedListener(mp -> { if (player == mp) { mp.start(); js("onMusic", "playing"); } });
            p.setOnErrorListener((mp, what, extra) -> { if (player == mp) js("onMusic", "error"); return true; });
            p.setOnCompletionListener(mp -> { if (player == mp) js("onMusic", "error"); });   // a live stream that ends has dropped
            player = p;
            setMusicOn(true);
            p.prepareAsync();
        } catch (Exception e) { js("onMusic", "error"); }
    }

    private void musicRelease() {
        if (player == null) return;
        MediaPlayer p = player; player = null;
        try { p.release(); } catch (Exception ignored) { }
    }

    // ---------- open-data lookups (weather, encyclopedia) for hosts on the allowlist ----------

    private void httpGet(String reqId, String url) {
        JSONObject res = new JSONObject();
        try {
            res.put("id", reqId);
            URL u = new URL(url);
            if (!"https".equals(u.getProtocol()) || !HTTP_HOSTS.contains(u.getHost())) throw new Exception("host not allowed");
            HttpURLConnection c = (HttpURLConnection) u.openConnection();
            c.setConnectTimeout(8000);
            c.setReadTimeout(10000);
            c.setRequestProperty("User-Agent", "Pomoshnik/1.0 (home tablet assistant)");
            c.setRequestProperty("Accept", "application/json");
            int code = c.getResponseCode();
            InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            if (in != null) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0 && out.size() < 2_000_000) out.write(buf, 0, n);
                in.close();
            }
            res.put("status", code);
            res.put("body", new String(out.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            try { res.put("status", 0); res.put("body", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        js("onHttp", res.toString());
    }

    // ---------- bridge to the page ----------

    private void js(String fn, String arg) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript(
                    "window.__native&&window.__native." + fn + "&&window.__native." + fn + "(" + JSONObject.quote(arg) + ")", null);
        });
    }

    private class Bridge {
        @JavascriptInterface public boolean isNative() { return true; }

        @JavascriptInterface public void ping() { lastPing = System.currentTimeMillis(); }

        // when this version was installed: the page runs its self-check once after each update
        @JavascriptInterface public long installedAt() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime; } catch (Exception e) { return 0; }
        }

        @JavascriptInterface public void speak(String text) {
            if (!ttsReady) { js("onSpeakEnd", ""); return; }
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "u" + System.nanoTime());
        }

        @JavascriptInterface public void stopSpeaking() { if (tts != null) tts.stop(); }

        @JavascriptInterface public boolean canListen() { return SpeechRecognizer.isRecognitionAvailable(MainActivity.this); }

        @JavascriptInterface public void listen() { main.post(MainActivity.this::startListening); }

        @JavascriptInterface public void stopListening() { main.post(() -> { if (recognizer != null) recognizer.stopListening(); }); }

        @JavascriptInterface public void cancelListening() { main.post(() -> { if (recognizer != null) recognizer.cancel(); }); }

        @JavascriptInterface public void setBeepMute(boolean mute) { main.post(() -> setBeepsMuted(mute)); }

        @JavascriptInterface public void setMusicPlaying(boolean on) { main.post(() -> setMusicOn(on)); }

        @JavascriptInterface public void musicPlay(String url) { main.post(() -> MainActivity.this.musicPlay(url)); }

        @JavascriptInterface public void musicStop() { main.post(() -> { musicRelease(); setMusicOn(false); }); }

        @JavascriptInterface public void musicVolume(float v) {
            main.post(() -> { musicVol = Math.max(0f, Math.min(1f, v)); if (player != null) player.setVolume(musicVol, musicVol); });
        }

        @JavascriptInterface public void httpGet(String reqId, String url) { io.execute(() -> MainActivity.this.httpGet(reqId, url)); }

        @JavascriptInterface public String voiceName() { return voiceName; }

        // the installed Russian voices: name|quality|needs network
        @JavascriptInterface public String voices() {
            StringBuilder sb = new StringBuilder();
            try {
                for (Voice v : tts.getVoices()) {
                    if (!"ru".equals(v.getLocale().getLanguage())) continue;
                    if (v.getFeatures() != null && v.getFeatures().contains("notInstalled")) continue;
                    sb.append(v.getName()).append('|').append(v.getQuality()).append('|').append(v.isNetworkConnectionRequired()).append('\n');
                }
            } catch (Exception ignored) { }
            return sb.toString();
        }

        @JavascriptInterface public void setVoice(String name) {
            main.post(() -> { Voice v = ttsReady ? findVoice(name) : null; if (v != null) { tts.setVoice(v); voiceName = v.getName(); } });
        }

        @JavascriptInterface public void benchVoice(String name) { main.post(() -> MainActivity.this.benchVoice(name)); }

        @JavascriptInterface public boolean getAutostart() { return getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(PREF_AUTOSTART, true); }

        @JavascriptInterface public void setAutostart(boolean on) { getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(PREF_AUTOSTART, on).apply(); }

        @JavascriptInterface public boolean canStartItself() { return android.provider.Settings.canDrawOverlays(MainActivity.this); }

        @JavascriptInterface public void vibrate(int ms) {
            Vibrator v = getSystemService(Vibrator.class);
            if (v != null && v.hasVibrator()) v.vibrate(VibrationEffect.createOneShot(Math.max(1, ms), VibrationEffect.DEFAULT_AMPLITUDE));
        }
    }

    // ---------- window ----------

    private void enterImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // let the page close an open sheet first; otherwise keep the app running in the background
        web.evaluateJavascript("window.__native&&window.__native.onBack?window.__native.onBack():false", value -> {
            if (!"true".equals(value)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onPause() {
        setBeepsMuted(false);   // never leave the tablet muted when the app is not in front
        inFront = false;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(watchdog);
        musicRelease();
        setBeepsMuted(false);
        io.shutdownNow();
        if (tts != null) tts.shutdown();
        if (recognizer != null) recognizer.destroy();
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
