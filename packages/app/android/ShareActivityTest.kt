package com.github.hami9.proc123

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.SpannableString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ShareActivityTest {
    @Test
    fun browserResultShareForwardsOnlyTextToTheExistingAppTask() {
        val incoming = Intent(Intent.ACTION_SEND).setType("Text/Plain; charset=utf-8")
            .putExtra(Intent.EXTRA_TEXT, SpannableString("فروشگاه https://shop.example/c/"))
            .putExtra(Intent.EXTRA_STREAM, Uri.parse("content://browser/private"))
            .addFlags(Intent.FLAG_ACTIVITY_FORWARD_RESULT or Intent.FLAG_ACTIVITY_PREVIOUS_IS_TOP or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        val activity = Robolectric.buildActivity(ShareActivity::class.java, incoming).create().get()
        val outgoing = shadowOf(activity).nextStartedActivity
        assertEquals("com.github.hami9.proc123.MainActivity", outgoing.component?.className)
        assertEquals(Intent.ACTION_SEND, outgoing.action)
        assertEquals("text/plain", outgoing.type)
        assertEquals("فروشگاه https://shop.example/c/", outgoing.getStringExtra(Intent.EXTRA_TEXT))
        assertEquals(setOf(Intent.EXTRA_TEXT), outgoing.extras?.keySet())
        assertEquals(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP, outgoing.flags)
        assertNull(outgoing.clipData)
        assertNull(outgoing.data)
        assertFalse(incoming.hasExtra(Intent.EXTRA_TEXT))
        assertTrue(activity.isFinishing)
    }

    @Test
    fun invalidOrOversizedSharesDoNotLaunchTheHost() {
        val context = Robolectric.buildActivity(Activity::class.java).setup().get()
        val intents = listOf(
            Intent(Intent.ACTION_VIEW).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://shop.example/"),
            Intent(Intent.ACTION_SEND).setType("text/html").putExtra(Intent.EXTRA_TEXT, "https://shop.example/"),
            Intent(Intent.ACTION_SEND).setType("text/plain"),
            Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, 42),
            Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "x".repeat(8193))
        )
        for (intent in intents) assertNull(shareLaunch(context, intent))
    }

    @Test
    fun restoredReceiverDoesNotReplayTheShare() {
        val intent = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "https://shop.example/")
        val activity = Robolectric.buildActivity(ShareActivity::class.java, intent).create(Bundle()).get()
        assertNull(shadowOf(activity).nextStartedActivity)
        assertTrue(activity.isFinishing)
    }
}
