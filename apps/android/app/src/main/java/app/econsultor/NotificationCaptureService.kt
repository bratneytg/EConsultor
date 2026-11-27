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
        val pkg = n.packageName
        val chosen = Capture.selected(this).contains(pkg)
        val notif = n.notification ?: return
        // Reproductores, descargas, llamadas… y los resúmenes de grupo no son pagos.
        if (notif.flags and (Notification.FLAG_ONGOING_EVENT or Notification.FLAG_GROUP_SUMMARY) != 0) {
            if (chosen) Capture.noteEvent(this, pkg, "filtered")
            return
        }
        val extras = notif.extras ?: return
        val title = (extras.getCharSequence(Notification.EXTRA_TITLE) ?: extras.getCharSequence(Notification.EXTRA_TITLE_BIG))?.toString().orEmpty()
        val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.takeIf { it.isNotBlank() }
        var text = (big ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()).orEmpty()
        // Algunas apps ponen el contenido en líneas (InboxStyle) o en mensajes (MessagingStyle), no en el texto.
        if (text.isBlank()) text = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.joinToString(" ") { it.toString() }.orEmpty()
        if (text.isBlank()) {
            @Suppress("DEPRECATION")
            text = extras.getParcelableArray(Notification.EXTRA_MESSAGES)?.mapNotNull { (it as? android.os.Bundle)?.getCharSequence("text")?.toString() }?.joinToString(" ").orEmpty()
        }
        if (text.isBlank()) text = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString().orEmpty()
        if (text.length < 4 || !amountHint.containsMatchIn("$title $text")) {
            if (chosen) Capture.noteEvent(this, pkg, "no_amount")
            return
        }

        if (!chosen) {
            // No se lee ni se envía nada de apps no elegidas; solo se recuerda su nombre para ofrecerla en la lista.
            if (Capture.KNOWN.containsKey(pkg)) Capture.noteEvent(this, pkg, "not_selected")
            val label = extras.getString("android.substName") ?: pkg
            Capture.noteSeen(this, pkg, label)
            return
        }
        val item = JSONObject()
            .put("source", "notification")
            .put("app", pkg)
            .put("title", title.take(200))
            .put("text", text.take(1000))
            .put("at", Instant.ofEpochMilli(n.postTime).toString())
            // Mismo aviso reenviado (cola, reconexión): el servidor no lo duplica.
            .put("id", "a${pkg.hashCode()}-${n.postTime}-${(title + text).hashCode()}")
        Capture.enqueue(this, item)
        Capture.noteEvent(this, pkg, "queued")
        Capture.flush(this)
    }
}
