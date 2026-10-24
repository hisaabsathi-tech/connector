/** biome-ignore-all lint/suspicious/noConsole: this CLI reports build progress */

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { androidEnv, gradlew } from "./android-env";
import { acquireBuildLock } from "./build-lock";
import { assertApiReachable, productionEnv, signingEnv } from "./release-env";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expo = resolve(root, "node_modules/.bin/expo");
// Every real Android phone is ARM; 32-bit armeabi-v7a still covers budget phones. By default this
// builds one APK per CPU type: `…-v<version>.apk` for 64-bit phones (almost all) and
// `…-v<version>-32bit.apk` for the rest, since each phone only needs its own native code.
// `--universal` makes a single APK that installs on both instead; `--abi arm64-v8a` builds just
// that type, and x86 (emulators only) can be added the same way.
const defaultAbis = "armeabi-v7a,arm64-v8a";
// A warm Gradle daemon makes repeat local builds faster; CI runners are thrown away after one build.
const daemonArgs = process.env.CI ? ["--no-daemon"] : [];
const abiIndex = process.argv.indexOf("--abi");
const abiArg = process.argv.find((arg) => arg.startsWith("--abi="))?.slice("--abi=".length);
const abis = abiArg ?? (abiIndex >= 0 ? process.argv[abiIndex + 1] : undefined) ?? defaultAbis;
const universal = process.argv.includes("--universal");
// Several CPU types and not --universal: one APK each.
const split = !universal && abis.includes(",");
// Every build also makes the Play Console app bundle (`…-v<version>.aab`) beside the APKs, in a
// second Gradle run: Gradle can't build a bundle while splitting APKs by CPU type
// (issuetracker.google.com/402800800). It holds every CPU type; Play sends each phone only its own.
// `--no-aab` skips it for a quicker APK-only build.
const aab = !process.argv.includes("--no-aab");

/** The file name suffix that tells people which phones an APK is for. */
function abiSuffix(abi: string): string {
  if (abi === "arm64-v8a") return "";
  if (abi === "armeabi-v7a") return "-32bit";
  return `-${abi}`;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = root): void {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${[command, ...args].join(" ")} failed`);
}

try {
  const { version } = JSON.parse(readFileSync(resolve(root, "version.json"), "utf8"));
  acquireBuildLock();
  const production = productionEnv();
  await assertApiReachable(production.apiUrl);
  const { env } = androidEnv();
  const buildEnv = { ...env, ...signingEnv(), ...production.env };

  const outDir = resolve(root, "apks/android");
  const releaseDir = resolve(root, "android/app/build/outputs/apk/release");
  // Built APK → where it is copied.
  const outputs = split
    ? abis.split(",").map((abi) => ({
        apk: resolve(outDir, `hisaabsathi-connect-v${version}${abiSuffix(abi)}.apk`),
        built: resolve(releaseDir, `app-${abi}-release.apk`),
      }))
    : [
        {
          apk: resolve(
            outDir,
            `hisaabsathi-connect-v${version}${abis === defaultAbis ? "" : `-${abis.replaceAll(",", "-")}`}.apk`,
          ),
          built: resolve(releaseDir, "app-release.apk"),
        },
      ];
  // Remove the previous build of this version first, so a failed build never leaves a stale APK.
  const bundleOut = resolve(outDir, `hisaabsathi-connect-v${version}.aab`);
  for (const { apk } of outputs) rmSync(apk, { force: true });
  rmSync(bundleOut, { force: true });

  console.log(
    `Building production APK${split ? "s" : ""} v${version} (${abis}${split ? ", one per CPU type" : ""})${aab ? " and the Play Console bundle" : ""} for ${production.apiUrl}`,
  );
  if (production.empty.length > 0) {
    console.warn(`Warning: empty in .env.production: ${production.empty.join(", ")}`);
  }

  run(expo, ["prebuild", "--platform", "android", "--no-install", "--clean"], buildEnv);
  run("bun", ["scripts/configure-android-signing.ts"], buildEnv);
  run(
    gradlew[0],
    [
      ...gradlew.slice(1),
      "assembleRelease",
      ...daemonArgs,
      `-PreactNativeArchitectures=${abis}`,
      `-PsplitApksByAbi=${split}`,
    ],
    buildEnv,
    resolve(root, "android"),
  );

  mkdirSync(outDir, { recursive: true });
  console.log("");
  for (const { apk, built } of outputs) {
    // Release bundles only contain EXPO_PUBLIC_ values read with a static key; a missing API URL
    // means the app would crash on launch.
    const bundle = spawnSync("unzip", ["-p", built, "assets/index.android.bundle"], {
      maxBuffer: 256 * 1024 * 1024,
    });
    if (bundle.status !== 0 || !bundle.stdout.includes(production.apiUrl)) {
      throw new Error(
        `The JS bundle in ${relative(root, built)} does not contain ${production.apiUrl}. Read env ` +
          "values as static `process.env.EXPO_PUBLIC_*` keys, never `process.env[name]`.",
      );
    }
    copyFileSync(built, apk);
    const size = (statSync(apk).size / 1024 / 1024).toFixed(1);
    console.log(`Production APK ready (${size} MB): ${relative(root, apk)}`);
  }
  if (aab) {
    run(
      gradlew[0],
      [
        ...gradlew.slice(1),
        "bundleRelease",
        ...daemonArgs,
        `-PreactNativeArchitectures=${abis}`,
        "-PsplitApksByAbi=false",
      ],
      buildEnv,
      resolve(root, "android"),
    );
    copyFileSync(
      resolve(root, "android/app/build/outputs/bundle/release/app-release.aab"),
      bundleOut,
    );
    const size = (statSync(bundleOut).size / 1024 / 1024).toFixed(1);
    console.log(`Play Console bundle ready (${size} MB): ${relative(root, bundleOut)}`);
  }
  console.log("Install on a connected phone: bun run android:device:install");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
