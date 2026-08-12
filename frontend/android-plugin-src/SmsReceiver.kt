package com.smartexpense.app.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService

/**
 * Fires on every incoming SMS. Deliberately does not parse the PDU itself — it just
 * wakes the headless JS task, which re-polls the SMS content provider via
 * react-native-get-sms-android and reuses the exact same read/parse/ingest path as the
 * manual "Sync now" button in sms-sync.tsx.
 */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "android.provider.Telephony.SMS_RECEIVED") {
            val serviceIntent = Intent(context, SmsHeadlessTaskService::class.java)
            context.startService(serviceIntent)
            HeadlessJsTaskService.acquireWakeLockNow(context)
        }
    }
}
