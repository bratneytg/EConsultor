package app.econsultor

import android.content.Context

/** Ajustes guardados en el teléfono. La fuente de verdad del recordatorio es la cuenta (la web los sincroniza). */
object Prefs {
    private fun sp(c: Context) = c.getSharedPreferences("econsultor", Context.MODE_PRIVATE)

    fun serverUrl(c: Context): String = (sp(c).getString("server", null) ?: BuildConfig.SERVER_URL).trimEnd('/')
    fun setServerUrl(c: Context, url: String) = sp(c).edit().putString("server", url.trim().trimEnd('/')).apply()

    // Por defecto: aviso diario a las 9:00 hasta que la cuenta diga otra cosa.
    fun reminderEnabled(c: Context): Boolean = sp(c).getBoolean("rem_on", true)
    fun reminderTime(c: Context): String = sp(c).getString("rem_time", "09:00") ?: "09:00"
    fun setReminder(c: Context, enabled: Boolean, hhmm: String) =
        sp(c).edit().putBoolean("rem_on", enabled).putString("rem_time", hhmm).apply()
}
