/** Apply the versioned Android source overlay after `tauri android init`. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';

const app = fileURLToPath(new URL('../', import.meta.url));
const marker = '<!-- proc123 share entry -->';
const filter = `${marker}
            <intent-filter>
                <action android:name="android.intent.action.SEND" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/plain" />
            </intent-filter>`;

export function shareManifest(source) {
  const activity = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>[\s\S]*?<\/activity>/;
  const match = source.match(activity);
  if (!match || !match[0].includes('android:launchMode="singleTask"')) {
    throw new Error('Expected the generated singleTask MainActivity. Check the Tauri template.');
  }
  if (match[0].includes(marker)) {
    if (!match[0].includes(filter)) throw new Error('The Android share filter has drifted.');
    return source;
  }
  return source.replace(
    activity,
    match[0].replace('</activity>', `${filter}\n        </activity>`)
  );
}

export async function prepareShare(project = resolve(app, 'src-tauri/gen/android')) {
  const manifest = resolve(project, 'app/src/main/AndroidManifest.xml');
  const kotlin = resolve(project, 'app/src/main/java/com/github/hami9/proc123');
  // Fail closed on an identifier/template change instead of producing a broken APK.
  const main = await readFile(resolve(kotlin, 'MainActivity.kt'), 'utf8');
  if (!/^package com\.github\.hami9\.proc123\s/m.test(main)) {
    throw new Error('The Android identifier has changed. Update the share source overlay.');
  }
  const updated = shareManifest(await readFile(manifest, 'utf8'));
  await writeFile(manifest, updated);
  await writeFile(
    resolve(kotlin, 'SharePlugin.kt'),
    await readFile(resolve(app, 'android/SharePlugin.kt'))
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareShare();
  console.log('Android share entry prepared.');
}
