package app.econsultor

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.util.Calendar

/**
 * Aviso diario para anotar los gastos. Lo programa el propio teléfono (AlarmManager), así que
 * llega aunque la app esté cerrada y sin depender de ningún servicio de notificaciones externo.
 * Se usa una alarma «inexacta en reposo»: puede retrasarse unos minutos con el móvil dormido, pero
 * no necesita el permiso especial de alarmas exactas.
 */
object Reminders {
    const val CHANNEL = "recordatorio"
    private const val NOTIFICATION_ID = 1001

    private val MENSAJES = listOf(
        "¿Cómo ha ido el día? Anota tus gastos de hoy en 30 segundos.",
        "Un minuto ahora y tus gráficas quedan al día.",
        "No dejes que se acumulen: apunta lo de hoy y sigue tu racha.",
    )

    fun ensureChannel(c: Context) {
        val ch = NotificationChannel(CHANNEL, c.getString(R.string.channel_name), NotificationManager.IMPORTANCE_DEFAULT)
        ch.description = c.getString(R.string.channel_desc)
        c.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    private fun pending(c: Context): PendingIntent =
        PendingIntent.getBroadcast(c, 1, Intent(c, ReminderReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** Programa (o cancela) la próxima alarma según los ajustes guardados. */
    fun schedule(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java)
        val pi = pending(c)
        am.cancel(pi)
        if (!Prefs.reminderEnabled(c)) return
        val (h, m) = parse(Prefs.reminderTime(c))
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
            if (timeInMillis <= System.currentTimeMillis() + 1000) add(Calendar.DAY_OF_YEAR, 1)
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.timeInMillis, pi)
    }

    fun show(c: Context) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return
        ensureChannel(c)
        val open = Intent(c, MainActivity::class.java)
            .putExtra("path", "/?add=1")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val tap = PendingIntent.getActivity(c, 2, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val text = MENSAJES[(System.currentTimeMillis() / 86_400_000L % MENSAJES.size).toInt()]
        val n = NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_bell)
            .setContentTitle("EConsultor")
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
        try {
            NotificationManagerCompat.from(c).notify(NOTIFICATION_ID, n)
        } catch (_: SecurityException) {
            // Sin permiso de notificaciones: no hay nada que hacer.
        }
    }

    private fun parse(hhmm: String): Pair<Int, Int> {
        val p = hhmm.split(":")
        val h = p.getOrNull(0)?.toIntOrNull()?.coerceIn(0, 23) ?: 9
        val m = p.getOrNull(1)?.toIntOrNull()?.coerceIn(0, 59) ?: 0
        return h to m
    }
}
