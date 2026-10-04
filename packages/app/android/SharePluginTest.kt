package com.github.hami9.proc123

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StyleSpan
import android.webkit.WebView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Exercises Android's Intent extra types, not a JavaScript mock of the inbox. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class SharePluginTest {
    private lateinit var activity: Activity
    private lateinit var plugin: SharePlugin

    @Before
    fun setUp() {
        activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        plugin = SharePlugin(activity)
    }

    private fun share(text: CharSequence, mime: String = "text/plain"): Intent =
        Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_TEXT, text)

    @Test
    fun coldShareIsConsumedOnceAcrossReloads() {
        activity.intent = share("https://shop.example/c/")
        val webView = WebView(activity)
        plugin.load(webView)
        assertFalse(activity.intent.hasExtra(Intent.EXTRA_TEXT))
        assertEquals("https://shop.example/c/", plugin.takeText())
        plugin.load(webView)
        assertNull(plugin.takeText())
        val replacement = SharePlugin(activity)
        replacement.load(webView)
        assertNull(replacement.takeText())
    }

    @Test
    fun warmShareAcceptsStyledCharSequence() {
        val text = SpannableString("فروشگاه\nhttps://shop.example/c/")
        text.setSpan(StyleSpan(Typeface.BOLD), 0, 7, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        val intent = share(text)
        plugin.onNewIntent(intent)
        assertEquals(text.toString(), plugin.takeText())
        assertFalse(intent.hasExtra(Intent.EXTRA_TEXT))
        plugin.onNewIntent(intent)
        assertNull(plugin.takeText())
    }

    @Test
    fun explicitlyTargetedShareNormalizesMimeType() {
        for (mime in listOf("text/plain; charset=utf-8", " TEXT/PLAIN ", "Text/Plain; Charset=UTF-8")) {
            plugin.onNewIntent(share("https://shop.example/c/", mime))
            assertEquals(mime, "https://shop.example/c/", plugin.takeText())
        }
    }

    @Test
    fun unsupportedIntentsDoNotEnterInbox() {
        val intents = listOf(
            share("https://shop.example/c/", "text/html"),
            share("https://shop.example/c/", "application/octet-stream"),
            share("https://shop.example/c/").setAction(Intent.ACTION_VIEW),
            share("https://shop.example/c/").setAction(Intent.ACTION_SEND_MULTIPLE),
            Intent(Intent.ACTION_SEND).putExtra(Intent.EXTRA_TEXT, "https://shop.example/c/"),
            Intent(Intent.ACTION_SEND).setType("text/plain"),
            Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, 42)
        )
        for (intent in intents) plugin.onNewIntent(intent)
        assertNull(plugin.takeText())
    }

    @Test
    fun oversizedSharesAreConsumedButNotQueued() {
        val intent = share("x".repeat(8193))
        plugin.onNewIntent(intent)
        assertFalse(intent.hasExtra(Intent.EXTRA_TEXT))
        assertNull(plugin.takeText())
        plugin.onNewIntent(share("x".repeat(8192)))
        assertEquals(8192, plugin.takeText()?.length)
    }

    @Test
    fun boundedInboxKeepsArrivalOrderAndAcceptsSharesAfterDrain() {
        for (index in 0..8) plugin.onNewIntent(share("https://shop.example/$index"))
        for (index in 0..7) assertEquals("https://shop.example/$index", plugin.takeText())
        assertNull(plugin.takeText())
        plugin.onNewIntent(share("https://shop.example/next"))
        assertEquals("https://shop.example/next", plugin.takeText())
    }
}
