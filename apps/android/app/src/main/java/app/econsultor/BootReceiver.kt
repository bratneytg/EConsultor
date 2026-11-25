package app.econsultor

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Tras reiniciar el teléfono, actualizar la app o cambiar la hora/zona, se vuelve a programar el aviso. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Reminders.schedule(context)
    }
}
