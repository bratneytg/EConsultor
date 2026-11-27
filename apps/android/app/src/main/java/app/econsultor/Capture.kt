package app.econsultor

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Captura de pagos: lee los avisos de las apps de banco o cartera que la persona marca y los manda a SU servidor
 * (el servidor es quien los interpreta). Solo viajan avisos de las apps elegidas y que contienen una cifra.
 * Si no hay conexión, quedan en una cola del teléfono y se reintentan al llegar otro aviso, al abrir la app o al reiniciar.
 */
object Capture {
    /** Apps de bancos y pagos habituales: se ofrecen ya marcadas si están instaladas. */
    val KNOWN = linkedMapOf(
        "com.google.android.apps.walletnfcrel" to "Google Wallet",
        "com.samsung.android.spay" to "Samsung Wallet",
        "de.number26.android" to "N26",
        "com.paypal.android.p2pmobile" to "PayPal",
        "com.revolut.revolut" to "Revolut",
        "com.transferwise.android" to "Wise",
        "com.bunq.android" to "bunq",
        "com.dkb.banking" to "DKB",
        "de.dkb.portalapp" to "DKB",
        "com.starfinanz.smob.android.sfinanzstatus" to "Sparkasse",
        "de.ing.banking" to "ING",
        "com.ing.mobile" to "ING",
        "de.commerzbanking.mobil" to "Commerzbank",
        "de.postbank.finanzassistent" to "Postbank",
        "com.db.pbc.mibanco" to "Deutsche Bank",
        "de.santander.presentation" to "Santander",
        "es.bancosantander.apps" to "Santander",
        "com.bbva.bbvacontigo" to "BBVA",
        "com.bbva.nxt_spain" to "BBVA",
        "es.lacaixa.mobile.imaginBank" to "imagin",
        "es.caixabank.caixabanknow" to "CaixaBank",
        "com.intesasanpaolo.inbank" to "Intesa Sanpaolo",
        "it.nogood.container" to "Hype",
        "com.unicredit" to "UniCredit",
        "it.bnl.apps.banking" to "BNL",
        "it.nexi.nexipay" to "Nexi Pay",
        "com.satispay.customer" to "Satispay",
        "com.mooneyapp.android" to "Mooney",
        "com.mediolanum.android.fullbanca" to "Banca Mediolanum",
        "com.n26" to "N26",
    )

    private const val FILE = "econsultor_capture"
    private val lock = Any()
    private val io = Executors.newSingleThreadExecutor()
    private fun sp(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private fun token(c: Context): String = sp(c).getString("token", "") ?: ""
    fun configured(c: Context): Boolean = token(c).startsWith("ecp_")

    fun setup(c: Context, tokenValue: String) {
        val e = sp(c).edit().putString("token", tokenValue)
        if (!sp(c).contains("apps")) e.putStringSet("apps", installedKnown(c))
        e.apply()
        flush(c)
    }

    fun disable(c: Context) {
        synchronized(lock) { sp(c).edit().remove("token").remove("queue").apply() }
    }

    private fun installedKnown(c: Context): Set<String> =
        KNOWN.keys.filter { installed(c, it) }.toSet()

    private fun installed(c: Context, pkg: String): Boolean = try {
        c.packageManager.getPackageInfo(pkg, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }

    fun selected(c: Context): Set<String> = sp(c).getStringSet("apps", emptySet()) ?: emptySet()
    fun setApps(c: Context, pkgs: List<String>) = sp(c).edit().putStringSet("apps", pkgs.filter { it.length in 3..200 }.toSet()).apply()

    /** Apps de bancos instaladas, más otras que han mandado avisos con importes (para que la persona decida). */
    fun apps(c: Context): String {
        val on = selected(c)
        val out = JSONArray()
        val seen = HashSet<String>()
        for ((pkg, label) in KNOWN) if (installed(c, pkg) && seen.add(pkg)) out.put(entry(pkg, label, on.contains(pkg), true))
        val others = JSONObject(sp(c).getString("seen", "{}") ?: "{}")
        for (pkg in others.keys()) if (seen.add(pkg)) out.put(entry(pkg, others.optString(pkg, pkg), on.contains(pkg), false))
        // Apps elegidas que ya no aparecen en ninguna lista siguen visibles para poder desmarcarlas.
        for (pkg in on) if (seen.add(pkg)) out.put(entry(pkg, KNOWN[pkg] ?: pkg, true, KNOWN.containsKey(pkg)))
        return out.toString()
    }

    private fun entry(pkg: String, label: String, on: Boolean, known: Boolean) =
        JSONObject().put("pkg", pkg).put("label", label).put("on", on).put("known", known)

    /** Recuerda una app que mandó un aviso con cifras y no está elegida, para ofrecerla en la lista. */
    fun noteSeen(c: Context, pkg: String, label: String) {
        synchronized(lock) {
            val seen = JSONObject(sp(c).getString("seen", "{}") ?: "{}")
            if (seen.has(pkg) || seen.length() >= 25) return
            seen.put(pkg, label.take(40).ifBlank { pkg })
            sp(c).edit().putString("seen", seen.toString()).apply()
        }
    }

    /** Último aviso de una app de banco que Android nos entregó y qué se hizo con él (sin guardar su texto). */
    fun noteEvent(c: Context, pkg: String, outcome: String) {
        val label = KNOWN[pkg] ?: pkg
        sp(c).edit().putString("last", JSONObject().put("pkg", pkg).put("label", label).put("at", System.currentTimeMillis()).put("outcome", outcome).toString()).apply()
    }

    private fun noteSend(c: Context, result: String) {
        sp(c).edit().putString("lastSend", result).putLong("lastSendAt", System.currentTimeMillis()).apply()
    }

    /** Si el permiso está dado pero Android no tiene el servicio conectado, le pide que lo vuelva a enlazar. */
    fun rebind(c: Context) {
        try {
            if (NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.packageName)) {
                NotificationListenerService.requestRebind(ComponentName(c, NotificationCaptureService::class.java))
            }
        } catch (_: Exception) { /* sin permiso o servicio no disponible */ }
    }

    fun status(c: Context): String {
        val access = NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.packageName)
        val last = try { JSONObject(sp(c).getString("last", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
        return JSONObject().put("access", access).put("configured", configured(c)).put("queued", queue(c).length()).put("sent", sp(c).getInt("sent", 0))
            .put("last", last).put("lastSend", sp(c).getString("lastSend", "") ?: "").put("lastSendAt", sp(c).getLong("lastSendAt", 0L)).toString()
    }

    private fun queue(c: Context): JSONArray = try { JSONArray(sp(c).getString("queue", "[]")) } catch (_: Exception) { JSONArray() }

    fun enqueue(c: Context, item: JSONObject) {
        synchronized(lock) {
            val q = queue(c)
            // Un aviso con el mismo id ya está esperando: no se repite.
            for (i in 0 until q.length()) if (q.getJSONObject(i).optString("id") == item.optString("id")) return
            q.put(item)
            // Como mucho 50 pendientes de envío: los más antiguos se descartan.
            val keep = JSONArray()
            for (i in maxOf(0, q.length() - 50) until q.length()) keep.put(q.get(i))
            sp(c).edit().putString("queue", keep.toString()).apply()
        }
    }

    /** Manda lo que haya en cola. Se para en el primer fallo de red o de servidor y lo reintenta otra vez. */
    fun flush(c: Context) {
        val app = c.applicationContext
        if (!configured(app)) return
        io.execute {
            while (true) {
                val item = synchronized(lock) { queue(app).optJSONObject(0) } ?: return@execute
                when (send(app, item)) {
                    Sent.OK, Sent.DROP -> synchronized(lock) {
                        val q = queue(app)
                        val rest = JSONArray()
                        for (i in 1 until q.length()) rest.put(q.get(i))
                        sp(app).edit().putString("queue", rest.toString()).putInt("sent", sp(app).getInt("sent", 0) + 1).apply()
                    }
                    Sent.AUTH -> { disable(app); return@execute }
                    Sent.RETRY -> return@execute
                }
            }
        }
    }

    private enum class Sent { OK, DROP, AUTH, RETRY }

    private fun send(c: Context, item: JSONObject): Sent {
        return try {
            val conn = URL(Prefs.serverUrl(c) + "/api/capture/in").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 20_000
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            conn.setRequestProperty("authorization", "Bearer " + token(c))
            conn.outputStream.use { it.write(item.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            conn.disconnect()
            noteSend(c, code.toString())
            when {
                code in 200..299 -> Sent.OK
                code == 401 -> Sent.AUTH
                code == 400 || code == 413 -> Sent.DROP // el servidor lo rechaza por su forma: reintentar no lo arregla
                else -> Sent.RETRY // 429, 5xx, proxy…
            }
        } catch (_: Exception) {
            noteSend(c, "net")
            Sent.RETRY
        }
    }
}
