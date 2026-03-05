# Mobile App Status

## What's Done

### Voice Session Hook (`src/features/voice/useVoiceSession.ts`)
- Connects to LiveKit room with retry logic (3 attempts, 12s timeout)
- Publishes local microphone track on connect
- Dispatches structured action envelopes from the agent via DataChannel
- **New:** Detects agent speaking via `RoomEvent.ActiveSpeakersChanged`
- **New:** Captures last agent transcript from DataChannel messages with topic `"transcript"` or `"chat"`
- **New:** Exposes `voiceStatus` (`connecting | listening | agent_speaking | disconnected | error`) and `lastAgentText`

### Home Screen (`src/features/home/HomeScreen.tsx`)
- **New:** Full voice-first UI with dark theme (`#0F0F23`)
- **New:** Agent name chip at top ("Coziyoo Assistant")
- **New:** Animated orb (160px) with state-driven color + animation:
  - `idle` → gray, static
  - `connecting` → gray, slow 2s pulse
  - `listening` → green `#4CAF50`, medium 1.2s pulse
  - `agent_speaking` → purple `#7C3AED`, fast orb pulse + 3 staggered concentric ripple rings
  - `error` → red `#EF4444`, static ring overlay
  - `disconnected` → fades to 30% opacity
- **New:** Status label below orb (shows last agent utterance during `agent_speaking`)
- **New:** Start / End Session buttons swap based on active state; error state shows "Retry"
- **New:** Debug log section (DEV only, collapsed by default) with event log, notes, settings hint
- Auto-starts voice session on login (existing behaviour preserved)

---

## Blocking Issues

### 1. `import.meta` SyntaxError

**Error:** `Uncaught SyntaxError: Cannot use 'import.meta' outside a module [runtime not ready]`

**What it means:** Metro bundler (and/or Hermes JS engine) does not support the `import.meta` syntax, which is a browser/ESM-only feature. When Metro bundles a file containing `import.meta`, it crashes at startup before the React Native runtime is even ready.

**What we ruled out:**
- `livekit-client`'s UMD build (`dist/livekit-client.umd.js`) — no `import.meta` found
- `livekit-client`'s ESM build (`dist/livekit-client.esm.mjs`) — no `import.meta` found
- `@livekit/react-native/src/` — no `import.meta` found

**Likely source (not yet confirmed):**
- A transitive dependency pulled in by `@livekit/react-native` or `livekit-client` (e.g. a WebRTC polyfill, `@livekit/protocol`, or `jose`)
- Metro resolving an ESM sub-path of a transitive package that uses `import.meta.url` or `import.meta.env`

**Possible solutions:**

**Option A — Babel plugin (recommended first try)**
Add `babel-plugin-transform-import-meta` to strip/replace `import.meta` at transpile time:
```bash
npm install --save-dev babel-plugin-transform-import-meta --workspace=apps/mobile
```
Then in `apps/mobile/babel.config.js`:
```js
module.exports = function(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['babel-plugin-transform-import-meta'],
  };
};
```

**Option B — Metro resolver (if Option A doesn't catch it)**
Create `apps/mobile/metro.config.js` to force Metro to prefer CJS/require conditions over ESM when resolving packages:
```js
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

// Prevent Metro from following `exports` → `import` condition
// which can resolve packages to ESM builds containing import.meta
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
```

**Option C — Identify and shim the specific package**
Run `npx react-native bundle --bundle-output /tmp/bundle.js 2>&1 | grep import.meta` to find the offending file, then add a Metro `resolveRequest` override to substitute it with a no-op shim.

---

### 2. `@livekit/react-native` Not Linked

**Error:** `Error: The package '@livekit/react-native' doesn't seem to be linked. Make sure you have run 'pod install' and rebuilt the app.`

**What it means:** `@livekit/react-native` contains native iOS/Android code (Objective-C/Java bridging WebRTC). It cannot run inside Expo Go, which only supports a fixed set of pre-compiled native modules. The package is installed (`apps/mobile/node_modules/@livekit/react-native` v2.9.6) but its native layer has never been compiled or linked — because the app has no `ios/` or `android/` directories yet.

**Root cause:** The app is currently in **Expo managed workflow**. It needs to be converted to a **development build** (bare-ish workflow via `expo prebuild`).

**Solution — Expo Development Build:**

```bash
# 1. Install the Expo config plugin shipped with @livekit/react-native (if present)
#    Check: cat apps/mobile/node_modules/@livekit/react-native/package.json | grep -A5 '"expo"'

# 2. Add plugin to apps/mobile/app.json "plugins" array:
#    "@livekit/react-native"
#    (only if the package ships an Expo plugin; otherwise skip)

# 3. Generate native projects
cd apps/mobile
npx expo prebuild

# 4a. Build + run on iOS simulator
npx expo run:ios

# 4b. OR build + run on Android emulator
npx expo run:android
```

After `prebuild`, `ios/` and `android/` directories are created, CocoaPods/Gradle link the native module, and the app runs as a development build (not Expo Go).

> **Note:** Once `ios/` and `android/` exist, the workflow changes — you must rebuild natively after any native dependency change. Add `ios/` and `android/` to `.gitignore` or commit them depending on team preference.

**Alternative — EAS Build (cloud):**
```bash
npm install -g eas-cli
eas build --profile development --platform ios
```
Generates a `.ipa` development build installable on a real device without a Mac/Xcode.

---

## Next Steps (in order)

1. **Try Option A** (babel plugin) to fix `import.meta` — quickest to test
2. **Run `npx expo prebuild`** in `apps/mobile/` to generate native projects
3. **Run `npx expo run:ios`** to compile and launch on simulator
4. Verify end-to-end voice flow: `idle → connecting → listening → agent_speaking → disconnected`
