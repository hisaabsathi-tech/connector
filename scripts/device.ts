/** biome-ignore-all lint/suspicious/noConsole: this CLI reports setup progress */

import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adb, chooseDevice, findAdb } from "./adb";
import { androidEnv } from "./android-env";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Gradle task lines and third-party deprecation warnings drown out progress; errors still print.
const verbose = process.argv.includes("--verbose");
// Metro, then the API server: the app reaches both at the phone's own localhost.
const TUNNEL_PORTS = [8081, 3000] as const;
const TUNNEL_CHECK_MS = 3000;

function openTunnels(adbBinary: string, deviceId: string, ports: readonly number[]) {
  for (const port of ports) {
    adb(adbBinary, ["-s", deviceId, "reverse", `tcp:${port}`, `tcp:${port}`]);
  }
}

/**
 * A USB drop (a loose cable, the phone asking again to allow USB debugging, adb restarting) ends
 * the tunnels, and the app then says the server can't be reached though it's running. While this
 * runs, they're put back as soon as the phone is back.
 */
function keepTunnels(adbBinary: string, deviceId: string) {
  let connected = true;
  setInterval(() => {
    try {
      const open = adb(adbBinary, ["-s", deviceId, "reverse", "--list"]);
      const missing = TUNNEL_PORTS.filter((port) => !open.includes(`tcp:${port} tcp:${port}`));
      if (missing.length === 0) return;
      openTunnels(adbBinary, deviceId, missing);
      console.log(`USB tunnel restored: phone localhost:${missing.join(", ")} → this computer`);
      connected = true;
    } catch {
      if (!connected) return;
      connected = false;
      console.log(
        "Phone disconnected from USB; the app can't reach this computer until it's back. If the phone asks, allow USB debugging (tick “Always allow”).",
      );
    }
  }, TUNNEL_CHECK_MS).unref();
}

try {
  const { env } = androidEnv();
  const adbBinary = findAdb();
  const device = await chooseDevice(adbBinary, "bun run device");
  openTunnels(adbBinary, device.id, TUNNEL_PORTS);
  for (const port of TUNNEL_PORTS) {
    console.log(`USB tunnel: phone localhost:${port} → this computer`);
  }
  keepTunnels(adbBinary, device.id);

  const child = spawn(
    join(root, "node_modules/.bin/expo"),
    ["run:android", "--device", device.model ?? device.id],
    {
      cwd: root,
      env: {
        ...env,
        // Metro workers trip Node's module.register() deprecation (DEP0205) once per worker.
        NODE_OPTIONS: [env.NODE_OPTIONS, "--disable-warning=DEP0205"].filter(Boolean).join(" "),
        ...(verbose
          ? {}
          : {
              GRADLE_OPTS: [env.GRADLE_OPTS, "-Dorg.gradle.logging.level=quiet"]
                .filter(Boolean)
                .join(" "),
            }),
      },
      stdio: "inherit",
    },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
