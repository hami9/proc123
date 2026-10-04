import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareShare, shareManifest, shareTests } from '../packages/app/scripts/android-share.mjs';

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <uses-permission android:name="android.permission.INTERNET" />
  <application><activity android:name=".MainActivity" android:launchMode="singleTask" android:exported="true">
    <intent-filter><action android:name="android.intent.action.MAIN" /><category android:name="android.intent.category.LAUNCHER" /></intent-filter>
  </activity><provider android:name="androidx.core.content.FileProvider" /></application>
</manifest>`;

describe('the Android source overlay', () => {
  it('keeps the launcher and provider and adds exactly one text share filter', () => {
    const result = shareManifest(MANIFEST);
    expect(result).toContain('android.intent.action.MAIN');
    expect(result).toContain('android.permission.INTERNET');
    expect(result).toContain('androidx.core.content.FileProvider');
    expect(result).toContain('android.intent.action.SEND');
    expect(result).toContain('android:mimeType="text/plain"');
    expect(shareManifest(result)).toBe(result);
  });

  it('fails if the activity template changes', () => {
    expect(() => shareManifest(MANIFEST.replace('singleTask', 'standard'))).toThrow('singleTask');
    expect(() => shareManifest(MANIFEST.replace('.MainActivity', '.OtherActivity'))).toThrow(
      'MainActivity'
    );
  });

  it('keeps existing Gradle settings and adds test dependencies only once', async () => {
    const tests = await readFile('packages/app/android/share-tests.gradle.kts', 'utf8');
    const existing = 'android { compileSdk = 36 }\n';
    const configured = shareTests(existing, tests);
    expect(configured).toContain(existing.trim());
    expect(configured).toContain('testImplementation("org.robolectric:robolectric:4.17")');
    expect(shareTests(configured, tests)).toBe(configured);
    expect(() => shareTests(configured.replace('4.17', '4.16'), tests)).toThrow('drifted');
  });

  it('applies the real Kotlin source reproducibly to a generated project', async () => {
    const project = await mkdtemp(join(tmpdir(), 'proc123-android-'));
    try {
      const main = join(project, 'app/src/main');
      const kotlin = join(main, 'java/com/github/hami9/proc123');
      await mkdir(kotlin, { recursive: true });
      await writeFile(join(main, 'AndroidManifest.xml'), MANIFEST);
      await writeFile(join(project, 'app/build.gradle.kts'), 'android { compileSdk = 36 }\n');
      await writeFile(
        join(kotlin, 'MainActivity.kt'),
        'package com.github.hami9.proc123\nclass MainActivity'
      );
      await prepareShare(project);
      await prepareShare(project);
      const manifest = await readFile(join(main, 'AndroidManifest.xml'), 'utf8');
      expect(manifest.match(/android.intent.action.SEND/g)).toHaveLength(1);
      const source = await readFile(join(kotlin, 'SharePlugin.kt'), 'utf8');
      expect(source).toContain('override fun onNewIntent');
      expect(source).toContain('accept(activity.intent)');
      expect(source).not.toContain('evaluateJavascript');
      const tests = await readFile(
        join(project, 'app/src/test/java/com/github/hami9/proc123/SharePluginTest.kt'),
        'utf8'
      );
      expect(tests).toBe(await readFile('packages/app/android/SharePluginTest.kt', 'utf8'));
      const gradle = await readFile(join(project, 'app/build.gradle.kts'), 'utf8');
      expect(gradle.match(/org.robolectric:robolectric/g)).toHaveLength(1);
    } finally {
      // This test owns this exact mkdtemp directory, never a workspace path.
      await rm(project, { recursive: true, force: true });
    }
  });
});
