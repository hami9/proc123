import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareShare, shareManifest } from '../packages/app/scripts/android-share.mjs';

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

  it('applies the real Kotlin source reproducibly to a generated project', async () => {
    const project = await mkdtemp(join(tmpdir(), 'proc123-android-'));
    try {
      const main = join(project, 'app/src/main');
      const kotlin = join(main, 'java/com/github/hami9/proc123');
      await mkdir(kotlin, { recursive: true });
      await writeFile(join(main, 'AndroidManifest.xml'), MANIFEST);
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
    } finally {
      // This test owns this exact mkdtemp directory, never a workspace path.
      await rm(project, { recursive: true, force: true });
    }
  });
});
