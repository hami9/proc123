package com.github.hami9.proc123

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** Browser result flags must not create another Tauri host in the browser task. */
class ShareActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            if (savedInstanceState == null) {
                shareLaunch(this, intent)?.let { startActivity(it) }
            }
        } finally {
            intent.removeExtra(Intent.EXTRA_TEXT)
            finish()
        }
    }
}

internal fun shareLaunch(context: Context, incoming: Intent): Intent? {
    if (incoming.action != Intent.ACTION_SEND || Intent.normalizeMimeType(incoming.type) != "text/plain") return null
    val text = try {
        incoming.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
    } catch (_: Exception) {
        null
    } ?: return null
    if (text.length > 8192) return null
    // Copy only bounded text. Never forward caller flags, URI grants or extras.
    // MainActivity remains singleTask; its existing plugin receives onNewIntent.
    return Intent(Intent.ACTION_SEND)
        .setClassName(context, "${context.packageName}.MainActivity")
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TEXT, text)
        .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
