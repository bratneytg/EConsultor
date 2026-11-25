package app.econsultor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (Prefs.reminderEnabled(context)) Reminders.show(context)
        Reminders.schedule(context) // la de mañana
    }
}
