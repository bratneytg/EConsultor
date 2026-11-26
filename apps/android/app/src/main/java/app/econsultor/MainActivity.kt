package app.econsultor

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.File

/**
 * Abre EConsultor (la misma web de tu servidor) en una pantalla completa de la app.
 * La cuenta, los datos y los gráficos son los mismos; la app añade el aviso diario del teléfono,
 * subir extractos, guardar la exportación en Descargas y el botón «atrás» de Android.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var offline: View
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        fileCallback = null
    }
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val serverHost: String? get() = Uri.parse(Prefs.serverUrl(this)).host

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        offline = findViewById(R.id.offline)
        findViewById<Button>(R.id.retry).setOnClickListener { cargar(null) }
        findViewById<Button>(R.id.change_server).setOnClickListener { pedirServidor() }

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            mediaPlaybackRequiresUserGesture = true
            userAgentString = "$userAgentString EConsultorAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(Bridge(), "EConsultorAndroid")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (uri.host == serverHost) return false
                // Cualquier otra dirección se abre fuera, en el navegador: el puente solo vive en tu servidor.
                try { startActivity(Intent(Intent.ACTION_VIEW, uri)) } catch (_: Exception) { }
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { offline.visibility = View.GONE }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) mostrarSinConexion()
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
                if (request.isForMainFrame && errorResponse.statusCode >= 500) mostrarSinConexion()
            }

            override fun onPageFinished(view: WebView, url: String?) { CookieManager.getInstance().flush() }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(w: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    chooser.launch(params.createIntent())
                    true
                } catch (_: Exception) {
                    fileCallback = null
                    false
                }
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else { isEnabled = false; onBackPressedDispatcher.onBackPressed() }
            }
        })

        Reminders.ensureChannel(this)
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        Reminders.schedule(this)

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else cargar(intent.getStringExtra("path"))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // Toque en la notificación o en el atajo «Anotar gasto» con la app ya abierta.
        cargar(intent.getStringExtra("path"))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    private fun cargar(path: String?) {
        // Solo rutas internas de la app; nunca una dirección completa venida de fuera.
        val safe = if (path != null && path.startsWith("/") && !path.startsWith("//")) path else "/"
        offline.visibility = View.GONE
        web.loadUrl(Prefs.serverUrl(this) + safe)
    }

    private fun mostrarSinConexion() { offline.visibility = View.VISIBLE }

    private fun pedirServidor() {
        val campo = EditText(this).apply {
            setText(Prefs.serverUrl(this@MainActivity))
            hint = getString(R.string.server_dialog_hint)
            setSingleLine()
        }
        AlertDialog.Builder(this)
            .setTitle(R.string.server_dialog_title)
            .setView(campo)
            .setPositiveButton(R.string.save) { _, _ ->
                val v = campo.text.toString().trim()
                if (v.startsWith("https://") && Uri.parse(v).host != null) {
                    Prefs.setServerUrl(this, v)
                    cargar(null)
                } else Toast.makeText(this, R.string.server_invalid, Toast.LENGTH_LONG).show()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    /** Lo que la web puede pedirle a la app. Solo se expone a la página de tu servidor. */
    inner class Bridge {
        @JavascriptInterface
        fun setReminder(enabled: Boolean, hhmm: String) {
            if (!Regex("^([01]\\d|2[0-3]):[0-5]\\d$").matches(hhmm)) return
            Prefs.setReminder(this@MainActivity, enabled, hhmm)
            Reminders.schedule(this@MainActivity)
        }

        @JavascriptInterface
        fun appVersion(): String = BuildConfig.VERSION_NAME

        /** Barras del sistema a juego con el tema claro/oscuro de la web. */
        @JavascriptInterface
        fun setBars(dark: Boolean) {
            runOnUiThread {
                val color = if (dark) 0xFF0D0D0D.toInt() else 0xFFF9F9F7.toInt()
                window.statusBarColor = color
                window.navigationBarColor = color
                WindowInsetsControllerCompat(window, window.decorView).apply {
                    isAppearanceLightStatusBars = !dark
                    isAppearanceLightNavigationBars = !dark
                }
            }
        }

        /**
         * Mantiene la pantalla encendida mientras la web lo pide (p. ej. al analizar un extracto, que puede tardar minutos).
         * Es un extra: el análisis corre en el servidor y sigue aunque la pantalla se apague.
         */
        @JavascriptInterface
        fun keepScreenOn(on: Boolean) {
            runOnUiThread {
                if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }

        // ── Huella del teléfono (BiometricPrompt + Keystore) ──
        @JavascriptInterface
        fun biometricAvailable(): Boolean = Biometric.available(this@MainActivity)

        @JavascriptInterface
        fun biometricInfo(): String = Biometric.info(this@MainActivity) ?: ""

        @JavascriptInterface
        fun biometricForget() = Biometric.forget(this@MainActivity)

        @JavascriptInterface
        fun biometricEnroll(cb: String, userId: String, id: String, secret: String, title: String, subtitle: String, cancel: String) {
            if (!validCallback(cb)) return
            runOnUiThread {
                Biometric.enroll(this@MainActivity, userId.take(100), id.take(100), secret.take(300), title.take(60), subtitle.take(120), cancel.take(30)) { ok, data ->
                    responder(cb, ok, data)
                }
            }
        }

        @JavascriptInterface
        fun biometricLogin(cb: String, title: String, subtitle: String, cancel: String) {
            if (!validCallback(cb)) return
            runOnUiThread {
                Biometric.login(this@MainActivity, title.take(60), subtitle.take(120), cancel.take(30)) { ok, data ->
                    responder(cb, ok, data)
                }
            }
        }

        private fun validCallback(cb: String) = Regex("^[A-Za-z0-9_-]{1,40}$").matches(cb)

        /** Devuelve el resultado a la web: `window.__ecBio(callbackId, ok, datos)`. */
        private fun responder(cb: String, ok: Boolean, data: String) {
            val js = "window.__ecBio && window.__ecBio(${org.json.JSONObject.quote(cb)}, $ok, ${org.json.JSONObject.quote(data)})"
            runOnUiThread { web.evaluateJavascript(js, null) }
        }

        /** Guarda un archivo de texto (la exportación de datos) en la carpeta Descargas. */
        @JavascriptInterface
        fun saveTextFile(name: String, mime: String, content: String) {
            val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { "econsultor.json" }
            val ok = try {
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    uri?.let { contentResolver.openOutputStream(it)?.use { o -> o.write(content.toByteArray()) } } != null
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    File(dir, safeName).writeText(content)
                    true
                }
            } catch (_: Exception) { false }
            runOnUiThread {
                Toast.makeText(
                    this@MainActivity,
                    if (ok) getString(R.string.saved_download, safeName) else getString(R.string.save_failed),
                    Toast.LENGTH_LONG,
                ).show()
            }
        }

        /** Guarda un archivo binario (el informe mensual en PDF) en Descargas; llega codificado en base64. */
        @JavascriptInterface
        fun saveBinaryFile(name: String, mime: String, base64: String) {
            val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_").take(80).ifEmpty { "econsultor.pdf" }
            val ok = try {
                val bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT)
                if (Build.VERSION.SDK_INT >= 29) {
                    val values = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                        put(MediaStore.Downloads.MIME_TYPE, mime)
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    uri?.let { contentResolver.openOutputStream(it)?.use { o -> o.write(bytes) } } != null
                } else {
                    val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                    File(dir, safeName).writeBytes(bytes)
                    true
                }
            } catch (_: Exception) { false }
            runOnUiThread {
                Toast.makeText(
                    this@MainActivity,
                    if (ok) getString(R.string.saved_download, safeName) else getString(R.string.save_failed),
                    Toast.LENGTH_LONG,
                ).show()
            }
        }
    }
}
