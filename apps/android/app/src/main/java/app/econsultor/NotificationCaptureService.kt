package app.econsultor

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONObject
import java.time.Instant

/** Lee los avisos de las apps de banco o cartera elegidas y los pasa a [Capture]. Solo actúa si la persona dio el permiso. */
class NotificationCaptureService : NotificationListenerService() {
    private val amountHint = Regex("""[€${'$'}£]|\b(eur|usd|gbp|chf)\b|\d[.,]\d{2}""", RegexOption.IGNORE_CASE)

    override fun onListenerConnected() {
        // Cada vez que Android conecta el servicio (arranque, permiso recién dado) se vacía la cola pendiente.
        if (Capture.configured(this)) Capture.flush(this)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        if (!Capture.configured(this) || n.packageName == packageName) return
        val notif = n.notification ?: return
        // Reproductores, descargas, llamadas… y los resúmenes de grupo no son pagos.
        if (notif.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_GROUP_SUMMARY) != 0) return
        val extras = notif.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
        val text = (big ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()).orEmpty()
        if (text.length < 4 || !amountHint.containsMatchIn("$title $text")) return

        if (!Capture.selected(this).contains(n.packageName)) {
            // No se lee ni se envía nada de apps no elegidas; solo se recuerda su nombre para ofrecerla en la lista.
            val label = extras.getString("android.substName") ?: n.packageName
            Capture.noteSeen(this, n.packageName, label)
            return
        }
        val item = JSONObject()
            .put("source", "notification")
            .put("app", n.packageName)
            .put("title", title.take(200))
            .put("text", text.take(1000))
            .put("at", Instant.ofEpochMilli(n.postTime).toString())
            // Mismo aviso reenviado (cola, reconexión): el servidor no lo duplica.
            .put("id", "a${n.packageName.hashCode()}-${n.postTime}-${(title + text).hashCode()}")
        Capture.enqueue(this, item)
        Capture.flush(this)
    }
}
