# Connector Commands

Every command for running, checking, and releasing the Connector Android app, with why you would use
it. Run all commands from the `connect/` folder.

## Quick reference

| I want to…                                     | Run                                  |
| ---------------------------------------------- | ------------------------------------ |
| Set up the project after cloning or pulling    | `bun install`                        |
| Run the app on my phone (first time or native change) | `bun run device`              |
| Run the app when the dev client is already installed | `bun run start`               |
| Add a new package                              | `bunx expo install <package>`        |
| Regenerate every Android logo asset            | `bun run logo:generate`              |
| Check code before finishing work               | `bun run lint` and `bun run typecheck` |
| Auto-fix formatting and lint issues            | `bun run fix`                        |
| Check Expo config and dependency health        | `bun run doctor`                     |
| Build a production APK to install on any phone | `bun run android:apk:build`                |
| Install that APK on a connected phone          | `bun run android:device:install`     |
| Remove every Connector app from a connected phone | `bun run android:device:uninstall` |
| Make a Play Store release                      | `bun run release`                    |
| Preview a release without changing anything    | `bun run release --dry-run`          |
| Create the signing key (only once, ever)       | `bun run credentials:generate`       |
| Build/release the APK on GitHub                | Actions → **Android APK** → Run workflow |

## One-time machine setup

The app builds locally, so the Mac needs Bun, JDK 21, and the Android SDK.

```bash
brew install oven-sh/bun/bun
brew install openjdk@21
brew install --cask android-commandlinetools
```

**Why:** `scripts/android-env.mjs` looks for the SDK and JDK in the Homebrew locations (or in
`ANDROID_HOME` / `JAVA_HOME`, or `~/Library/Android/sdk`). If either is missing, `device` and
`release` stop with an error telling you to install them.

On the phone: open **Settings → System → Developer options**, turn on **USB debugging**, plug it in,
choose **File transfer**, and tap **Allow** on the computer prompt.

## Install dependencies

```bash
bun install
```

**Why:** Installs everything in `package.json` into `node_modules/` using `bun.lock`. Run it after
cloning, after pulling changes that touch `package.json`, or if `node_modules/` was deleted.

## Daily development

### Run on a phone: `bun run device`

```bash
bun run device
```

**Why:** This is the main command for development. It runs `scripts/device.mjs`, which:

1. Finds the Android SDK and JDK 21.
2. Lists connected phones and asks which one to use (if more than one).
3. Sets up USB tunnels for ports `8081` (Metro) and `3000` (local server), so the phone can reach
   `localhost` on this computer.
4. Generates `android/`, builds the development client, installs it on the phone, and starts Metro.

**Use it when:** it is your first run, you added or updated a package with native code, or you changed
`app.config.ts` (icons, splash, plugins, package name). These all need a new native build.

If it says no device is ready: unlock the phone, pick **File transfer**, and check that USB debugging
is on.

### Start Metro only: `bun run start`

```bash
bun run start
```

**Why:** Runs `expo start`, which only starts the JavaScript bundler. It is much faster than `device`
because it skips the Android build.

**Use it when:** the dev client is already installed on the phone and you only changed JavaScript or
TypeScript (screens, styles, logic). Open the Connector app on the phone and it loads the new code.

> USB tunnels reset when the phone is unplugged. If the app cannot reach Metro or the server after
> reconnecting, run `bun run device` again, or set them up manually:
>
> ```bash
> adb reverse tcp:8081 tcp:8081
> adb reverse tcp:3000 tcp:3000
> ```

### Build and install without the device picker: `bun run android`

```bash
bun run android
```

**Why:** Runs `expo run:android` directly. It does the same build as `device` but skips the SDK
detection, device picker, and USB tunnels. Prefer `bun run device`; use this only if your shell
already has `ANDROID_HOME` and `JAVA_HOME` set and a single phone connected.

### Regenerate the native project: `bun run prebuild`

```bash
bun run prebuild
bun run prebuild --clean      # delete android/ and generate it fresh
```

**Why:** Runs `expo prebuild`, which writes `android/` from `app.config.ts` and plugins. The
`android/` folder is generated and ignored by git; never edit it by hand. You rarely need this
directly, because `device`, `android`, and `release` all generate it for you. Use `--clean` if a
native build behaves strangely after config changes.

### Change the Android app logo: `bun run logo:generate`

Replace `assets/logo/base/app.svg`, then run:

```bash
bun run logo:generate
```

**Why:** This generates the complete Expo/Android logo set in `assets/logo/android/`: the regular
app icon, adaptive foreground and background, Android 13+ monochrome icon, and detected color
metadata. It also renders `assets/logo/splash/dark.svg` to the native-compatible
`assets/logo/splash/dark.png`. The launcher and splash artwork follow the same safe-area proportions
used by `connector-v1`.

SVG is the preferred source. If there is no `app.svg`, the command uses `app.png`; the PNG must be
square. When both exist, SVG wins. You can select the PNG explicitly with:

```bash
bun run logo:generate -- --source=app.png
```

After changing the logo, run `bun run device` or make a release so Expo regenerates the native
Android resources. A Metro-only restart cannot change an installed launcher icon or splash screen.

See [branding-assets.md](branding-assets.md) for every source, generated, and Android density size,
including aspect ratios and artwork safe-area scaling.

## Adding packages

```bash
bunx expo install <package>
bunx expo install --fix   # fix packages whose versions don't match the Expo SDK
```

**Why:** `expo install` picks the version that matches this app's Expo SDK. Plain `bun add` can
install a version that does not work with the SDK. If the package includes native code, run
`bun run device` afterwards to rebuild the dev client.

## Checking code

Run lint and typecheck before you call any task done.

| Command             | What it runs       | Why                                                                         |
| ------------------- | ------------------ | --------------------------------------------------------------------------- |
| `bun run lint`      | `biome ci .`       | Checks formatting and lint rules without changing files. Fails on problems. |
| `bun run fix`       | `biome check --write .` | Auto-fixes formatting, import order, and safe lint issues.             |
| `bun run typecheck` | `tsc --noEmit`     | Finds TypeScript errors without producing any output files.                 |
| `bun run doctor`    | `expo-doctor`      | Finds Expo config problems and packages that don't match the SDK.           |

Typical flow: `bun run fix`, then `bun run lint`, then `bun run typecheck`.

## Production environment: `.env.production`

Release builds (`android:apk:build` and `release`) read **only** `.env.production`. The development `.env` is never
used for them, so a key missing from `.env.production` stays empty instead of silently falling back to
a development value. The build stops if `EXPO_PUBLIC_API_URL` is not a public `https` URL or if
`EXPO_PUBLIC_APPLICATION_MODE` is not `production`, and warns about any empty `EXPO_PUBLIC_` value.

**Why:** `EXPO_PUBLIC_` values are baked into the JavaScript bundle when it is built. Changing
`.env.production` later does not change an APK you already built; build again. These values ship in
the APK and are readable by anyone, so never put server secrets in this file. It is ignored by git.

## Build a production APK: `bun run android:apk:build`

```bash
bun run android:apk:build
```

**Why:** Builds a signed release APK with the production keys, ready to send to and install on any
Android phone. It:

1. Reads and checks `.env.production`.
2. Regenerates `android/` with `expo prebuild --clean`.
3. Adds release signing with the upload keystore in `.keys/`.
4. Runs `./gradlew assembleRelease` and copies one APK per CPU type to `apks/android/`:
   `hisaabsathi-connect-vX.Y.Z.apk` for 64-bit phones (almost all of them) and
   `hisaabsathi-connect-vX.Y.Z-32bit.apk` for older 32-bit ones.
5. Runs `./gradlew bundleRelease` and copies the Play Store bundle to the same folder:
   `hisaabsathi-connect-vX.Y.Z.aab`, the file to upload in Play Console. It holds every CPU type;
   Play sends each phone only its own.

It does **not** change `version.json`. Building the same version again first deletes the old APKs and bundle,
then writes the new ones in their place, so a failed build never leaves a stale file. After the build
it checks that the production API URL is really inside each APK's app bundle and fails if it is not.

The APKs are size-optimized: R8 removes unused Java/Kotlin code, unused resources are dropped, native
libraries are stored compressed, all set in `app.config.ts`. Only ARM CPU code is built (`arm64-v8a` and `armeabi-v7a`), which covers every
real Android phone, and each APK carries just one of the two, so it is roughly a quarter smaller than
an APK with both. For other targets:

```bash
bun run android:apk:build --no-aab                                  # APKs only, skip the Play Store bundle
bun run android:apk:build --universal                               # one APK for 64- and 32-bit phones
bun run android:apk:build --abi arm64-v8a                           # 64-bit phones only
bun run android:apk:build --abi armeabi-v7a,arm64-v8a,x86,x86_64    # one APK per type, also emulators
```

A `--universal` or single-type build gets the types in the file name, e.g.
`hisaabsathi-connect-v0.0.1-arm64-v8a.apk`. Copy the right file to a phone and open it (allow
"Install unknown apps" when asked), or install it over USB with `bun run android:device:install`.
`apks/` is ignored by git.

## Install the APK on a phone: `bun run android:device:install`

```bash
bun run android:device:install
bun run android:device:install --apk apks/android/hisaabsathi-connect-v0.0.1-32bit.apk
```

**Why:** Installs the production APK on a USB-connected phone and opens it. It:

1. Picks this version's APK for the phone's CPU type from `apks/android/` (64-bit or `-32bit`), or
   the newest APK there, or the one given with `--apk`.
2. Finds connected phones and asks which one if there is more than one. If none is ready, it explains
   how to enable USB debugging.
3. Checks the phone's CPU type is in the APK, and tells you which `--abi` to build if not.
4. Installs with `adb install -r`, keeping the app's data when updating.
5. If the phone has the development client (signed with a different key), asks before uninstalling
   it, because Android cannot replace it and uninstalling deletes the app's data.
6. Opens the app.

## Remove the app from a phone: `bun run android:device:uninstall`

```bash
bun run android:device:uninstall          # lists the apps, then asks before removing
bun run android:device:uninstall --yes    # no question
```

**Why:** Fully removes every Hisaab Sathi Connector app from a USB-connected phone: this app
(`in.hisaabsathi.connect`, release or dev client), Connector v1 (`com.hisaabsathi.connect`), and any
other package whose id contains `hisaabsathi` and `connect`. It also clears data left behind by an
app uninstalled with "keep data", and removes the apps for every user profile on the phone. Use it
before a clean test install, or when the dev client and release APK clash over signing keys.

## Releasing to the Play Store

### First time only: create the signing key

```bash
bun run credentials:generate
```

**Why:** Play Store updates must always be signed with the same upload key. This creates:

- `.keys/android-upload.jks` (the keystore)
- `.keys/android-release.env` (its passwords and alias)

It refuses to run if they already exist, so it cannot overwrite your key by accident. **Back up both
files in a password manager.** If they are lost, Play will reject future updates until Google resets
the upload key. `.keys/` is ignored by git.

### Make a release: `bun run release`

```bash
bun run release                   # asks patch / minor / major
bun run release --bump patch      # 0.0.1 → 0.0.2  (bug fixes)
bun run release --bump minor      # 0.0.1 → 0.1.0  (new features)
bun run release --bump major      # 0.0.1 → 1.0.0  (big or breaking changes)
```

**Why:** Runs `scripts/release.mjs`, which:

1. Bumps `version` in `version.json` and always adds 1 to `versionCode` (Play requires a higher
   `versionCode` for every upload).
2. Regenerates `android/` with `expo prebuild --clean`.
3. Adds release signing to the generated Gradle file (`scripts/configure-android-signing.mjs`).
4. Builds with Gradle and copies the outputs to `releases/vX.Y.Z/`:
   - `hisaabsathi-connect.aab`: upload this to the Play Console.
   - `hisaabsathi-connect.apk`: install directly on a phone for testing.

If the build fails, `version.json` is restored to the old version, so you can fix the problem and run
it again.

### Preview a release: `--dry-run`

```bash
bun run release --dry-run
bun run release --dry-run --bump minor
```

**Why:** Prints the new version and every step it would run, without changing `version.json` or
building anything. Use it to check the version numbers before a real release.

### Test the release APK on a phone

```bash
adb install -r releases/vX.Y.Z/hisaabsathi-connect.apk
```

**Why:** Installs the signed release build so you can test it exactly as users will get it. `-r`
replaces the installed app. If the dev client is installed, uninstall it first
(`adb uninstall in.hisaabsathi.connect`), because the two are signed with different keys.

## GitHub Actions: build and release the APK

`.github/workflows/android-apk.yml` builds the same production APK in the cloud and publishes it as a
GitHub release. It **never runs on an ordinary push**. Start it in one of two ways:

- **Commit flag:** put a flag anywhere in a commit message and push to `main`:

  | Flag in the commit message | Build type |
  | -------------------------- | ---------- |
  | `[apk]` or `[apk rebuild]` | `rebuild`  |
  | `[apk patch]`              | `patch`    |
  | `[apk minor]`              | `minor`    |
  | `[apk major]`              | `major`    |

  ```bash
  git commit -m "Fix login screen [apk]"          # rebuild the current version
  git commit -m "Add attendance screen [apk minor]"   # new minor release
  ```

  If several pushed commits carry a flag, the last one wins. A push without a flag skips the job and
  uses no Actions minutes. An unknown flag such as `[apk beta]` fails the run with the list of valid
  ones. Flags are lowercase.
- **By hand:** **Actions → Android APK → Run workflow** on `main`.

The build types:

| Choice                    | What happens                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- |
| `rebuild` (default)       | Builds the current `version.json` version again. Replaces `hisaabsathi-connect.apk` and `hisaabsathi-connect-32bit.apk` on that version's release and moves its tag to the rebuilt commit. Creates the release if the version has none. No version change. |
| `patch` / `minor` / `major` | Bumps `version.json` (and `versionCode`), builds, commits `Release vX.Y.Z` to `main`, and publishes a new `vX.Y.Z` release. Stops before building if that release already exists. |

The workflow runs `bun run lint`, `bun run typecheck`, and then `bun run android:apk:build`, so it uses the
same size optimizations and the same API-URL bundle check as a local build. Each release has two APKs:
`hisaabsathi-connect.apk` for 64-bit phones (almost all) and `hisaabsathi-connect-32bit.apk` for older
32-bit ones; the release notes say so. It also carries `hisaabsathi-connect.aab`, the app bundle to
upload to the Play Console. All three are also kept as a workflow artifact for 14 days. The newest
release's 64-bit APK is always at:

```
https://github.com/hisaabsathi-tech/connect/releases/latest/download/hisaabsathi-connect.apk
```

**Production values:** the public values (`EXPO_PUBLIC_API_URL=https://server.hisaabsathi.in`, auth
path, API prefix, GraphQL path) are in the workflow's `env:` block; change them there. The workflow
writes `.env.production` from them on the runner. Your local `.env.production` is not used.

### One-time secrets setup

The CI APK must be signed with the **same** upload key as local builds, or phones cannot update from
one to the other. Add these repository secrets once (from `connect/`, with `gh` signed in):

```bash
base64 -i .keys/android-upload.jks | gh secret set ANDROID_KEYSTORE_BASE64
gh secret set ANDROID_RELEASE_ENV < .keys/android-release.env
gh secret set EXPO_PUBLIC_OLA_MAPS_API_KEY        # paste the production Ola Maps key
```

| Secret                         | Contents                                         |
| ------------------------------ | ------------------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`      | `.keys/android-upload.jks`, base64-encoded       |
| `ANDROID_RELEASE_ENV`          | The whole `.keys/android-release.env` file        |
| `EXPO_PUBLIC_OLA_MAPS_API_KEY` | Production Ola Maps key                          |

The workflow stops with a clear message if any of them is empty.

## Useful adb commands

```bash
adb devices -l                            # list connected phones and their state
adb reverse --list                        # show active USB tunnels
adb uninstall in.hisaabsathi.connect      # remove the app from the phone
adb logcat '*:E'                          # show only error logs from the phone
```

If `adb` is not found, it lives in the SDK at
`/opt/homebrew/share/android-commandlinetools/platform-tools/adb`.

## Files these commands depend on

| File / folder         | Used by                     | Notes                                       |
| --------------------- | --------------------------- | ------------------------------------------- |
| `app.config.ts`       | all builds                  | App name, package id, icons, splash, plugins |
| `assets/logo/base/`   | `logo:generate`              | Editable master logo (`app.svg` or `app.png`) |
| `assets/logo/android/` | all builds                  | Generated Android launcher icon assets         |
| `assets/logo/splash/` | all builds                   | Splash SVG sources and generated native PNG    |
| `version.json`        | `release`, home screen      | Updated by `release`; don't edit by hand    |
| `scripts/`            | all `bun run` helpers       | Build helper scripts        |
| `.env.production`     | `android:apk:build`, `release`    | Production keys baked into release builds   |
| `.keys/`              | `android:apk:build`, `release`    | Signing key. Never commit or delete         |
| `android/`            | builds                      | Generated. Safe to delete; it is rebuilt    |
| `releases/`           | `release` output            | Built AAB and APK files, ignored by git     |
| `apks/android/`       | `android:apk:build`, `android:device:install` | Production APKs, ignored by git             |
