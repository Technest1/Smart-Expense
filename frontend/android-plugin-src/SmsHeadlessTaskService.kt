package com.technest.moneta.sms

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class SmsHeadlessTaskService : HeadlessJsTaskService() {
    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        return HeadlessJsTaskConfig(
            "SmsSyncTask",
            Arguments.createMap(),
            60000, // allow up to 60s for the SMS read + backend round trip
            true // allowedInForeground — needed so it can still run if the OS considers the app foregrounded
        )
    }
}
