package ru.home.pomoshnik;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens the assistant after the tablet boots or the app is updated (unless autostart is turned off). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE).getBoolean(MainActivity.PREF_AUTOSTART, true)) return;
        Intent open = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { context.startActivity(open); } catch (Exception ignored) { }
    }
}
