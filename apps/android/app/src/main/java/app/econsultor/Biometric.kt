package app.econsultor

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Entrar con la huella del teléfono.
 *
 * El WebView de Android no admite WebAuthn, así que la huella la gestiona la app:
 * un secreto aleatorio que el servidor reconoce por su hash se guarda cifrado con una clave del Keystore que
 * SOLO se puede usar tras pasar el BiometricPrompt (huella). La huella nunca llega a la app ni al servidor.
 */
object Biometric {
    private const val ALIAS = "econsultor_biometric_v1"
    private const val PREFS = "econsultor_bio"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    private fun sp(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** ¿El teléfono tiene una huella (o un método biométrico fuerte) registrada? */
    fun available(c: Context): Boolean =
        BiometricManager.from(c).canAuthenticate(BIOMETRIC_STRONG) == BiometricManager.BIOMETRIC_SUCCESS

    /** `{"userId":…,"id":…}` del dispositivo ya activado (no es secreto), o null. */
    fun info(c: Context): String? {
        val p = sp(c)
        val u = p.getString("userId", null)
        val i = p.getString("id", null)
        return if (u != null && i != null && p.getString("data", null) != null) """{"userId":"$u","id":"$i"}""" else null
    }

    fun forget(c: Context) {
        sp(c).edit().clear().apply()
        try {
            KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS)
        } catch (_: Exception) { }
    }

    private fun newKey(): SecretKey {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)
            .apply {
                // Cada uso exige la huella (sin ventana de validez).
                if (Build.VERSION.SDK_INT >= 30) setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
            }
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply { init(spec) }.generateKey()
    }

    private fun existingKey(): SecretKey? {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return ks.getKey(ALIAS, null) as? SecretKey
    }

    private fun prompt(
        activity: FragmentActivity,
        cipher: Cipher,
        title: String,
        subtitle: String,
        cancel: String,
        onOk: (Cipher) -> Unit,
        onFail: (String) -> Unit,
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val bp = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val c = result.cryptoObject?.cipher
                if (c == null) onFail("error") else try { onOk(c) } catch (_: Exception) { onFail("error") }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                val cancelled = errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                    errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                onFail(if (cancelled) "cancel" else errString.toString())
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButtonText(cancel)
            .setAllowedAuthenticators(BIOMETRIC_STRONG)
            .setConfirmationRequired(false)
            .build()
        bp.authenticate(info, BiometricPrompt.CryptoObject(cipher))
    }

    /** Guarda el secreto cifrado con la clave protegida por la huella. */
    fun enroll(
        activity: FragmentActivity, userId: String, id: String, secret: String,
        title: String, subtitle: String, cancel: String,
        done: (Boolean, String) -> Unit,
    ) {
        val cipher = try {
            forget(activity)
            Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, newKey()) }
        } catch (_: Exception) {
            done(false, "error")
            return
        }
        prompt(activity, cipher, title, subtitle, cancel, { c ->
            val enc = c.doFinal(secret.toByteArray(Charsets.UTF_8))
            sp(activity).edit()
                .putString("userId", userId)
                .putString("id", id)
                .putString("iv", Base64.encodeToString(c.iv, Base64.NO_WRAP))
                .putString("data", Base64.encodeToString(enc, Base64.NO_WRAP))
                .apply()
            done(true, "")
        }, { why ->
            try { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) } catch (_: Exception) { }
            done(false, why)
        })
    }

    /** Pide la huella y devuelve `{"userId","id","secret"}` en JSON. */
    fun login(
        activity: FragmentActivity, title: String, subtitle: String, cancel: String,
        done: (Boolean, String) -> Unit,
    ) {
        val p = sp(activity)
        val userId = p.getString("userId", null)
        val id = p.getString("id", null)
        val iv = p.getString("iv", null)
        val data = p.getString("data", null)
        if (userId == null || id == null || iv == null || data == null) { done(false, "none"); return }
        val cipher = try {
            val key = existingKey() ?: run { forget(activity); done(false, "invalidated"); return }
            Cipher.getInstance(TRANSFORM).apply {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            }
        } catch (_: KeyPermanentlyInvalidatedException) {
            // Se registró otra huella en el teléfono: Android invalida la clave. Hay que volver a activarla.
            forget(activity)
            done(false, "invalidated")
            return
        } catch (_: Exception) {
            done(false, "error")
            return
        }
        prompt(activity, cipher, title, subtitle, cancel, { c ->
            val secret = String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
            done(true, org.json.JSONObject().put("userId", userId).put("id", id).put("secret", secret).toString())
        }, { why -> done(false, why) })
    }
}
