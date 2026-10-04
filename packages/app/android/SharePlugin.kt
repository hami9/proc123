package com.github.hami9.proc123

import android.app.Activity
import android.content.Intent
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.ArrayDeque

/** A memory-only inbox. Shared text is data, never JavaScript to evaluate. */
@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
    private val pending = ArrayDeque<String>()

    override fun load(webView: WebView) {
        accept(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        accept(intent)
    }

    @Synchronized
    private fun accept(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND || Intent.normalizeMimeType(intent.type) != "text/plain") return
        val text = try {
            intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        } catch (_: Exception) {
            null
        }
        // Do not replay the launch intent after a WebView or activity reload.
        intent.removeExtra(Intent.EXTRA_TEXT)
        if (text == null || text.length > 8192 || pending.size >= 8) return
        pending.addLast(text)
    }

    @Command
    fun take(invoke: Invoke) {
        val result = JSObject()
        result.put("text", takeText())
        invoke.resolve(result)
    }

    @Synchronized
    internal fun takeText(): String? = pending.pollFirst()
}
