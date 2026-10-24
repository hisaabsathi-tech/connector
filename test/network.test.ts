import { beforeEach, describe, expect, it } from "bun:test";
import { AppState } from "react-native";

import { ApiError, apiRequest } from "@/lib/api/client";
import { graphqlRequest } from "@/lib/api/graphql";
import { isNetworkError, NetworkError, timedFetch } from "@/lib/api/network";
import {
  getConnectivity,
  isOnline,
  onReconnect,
  probe,
  reportReachable,
  reportUnreachable,
  startConnectivity,
} from "@/lib/network/connectivity";
import { retryOnce } from "@/lib/retry";

import { fake, freshPhone, settle, TOKEN } from "./fake";

beforeEach(() => {
  freshPhone();
  reportReachable();
});

describe("connectivity", () => {
  it("counts as online until repeated probes prove the server is down", async () => {
    expect(isOnline()).toBe(true);
    fake.server.offline = true;
    await probe();
    // One failed answer is degraded connectivity, not "server down".
    expect(isOnline()).toBe(true);
    await probe();
    await probe();
    expect(isOnline()).toBe(false);
    fake.server.offline = false;
    await probe();
    expect(isOnline()).toBe(true);
  });

  it("counts one network drop once, however many requests it fails at the same moment", async () => {
    fake.server.offline = true;
    // A screen loads several things at once; they all fail in the same drop.
    await Promise.all(
      Array.from({ length: 6 }, () => apiRequest("/anything", TOKEN).catch(() => undefined)),
    );
    await settle(5);
    expect(isOnline()).toBe(true);
  });

  it("forgets earlier failed pings once the server answers one", async () => {
    fake.server.offline = true;
    await probe();
    await probe();
    fake.server.offline = false;
    await probe();
    // A later single blip starts the count over instead of tipping it into "server down".
    fake.server.offline = true;
    await probe();
    expect(isOnline()).toBe(true);
  });

  it("tells listeners once per return from offline, not on every success", async () => {
    let reconnects = 0;
    const stop = onReconnect(() => {
      reconnects += 1;
    });
    reportReachable();
    reportReachable();
    expect(reconnects).toBe(0);
    reportUnreachable("no_network");
    reportReachable();
    reportReachable();
    expect(reconnects).toBe(1);
    stop();
  });

  it("follows the phone's own network state, confirming recovery with the server", async () => {
    startConnectivity();
    await settle();
    const network = fake.networkListeners.at(-1);
    if (!network) throw new Error("no network listener");
    network({ isConnected: false });
    expect(isOnline()).toBe(false);
    network({ isConnected: true, isInternetReachable: true });
    await settle(5);
    expect(isOnline()).toBe(true);
  });

  it("re-checks when the app comes back to the foreground", async () => {
    startConnectivity();
    reportUnreachable();
    for (const listener of fake.appListeners) listener("active");
    await settle(5);
    expect(isOnline()).toBe(true);
  });

  it("doesn't go offline while in the background, where Android pauses the network", async () => {
    startConnectivity();
    await settle();
    const network = fake.networkListeners.at(-1);
    if (!network) throw new Error("no network listener");
    const app = AppState as { currentState: string };
    app.currentState = "background";
    try {
      network({ isConnected: false });
      reportUnreachable("no_network");
      expect(isOnline()).toBe(true);
    } finally {
      app.currentState = "active";
    }
  });

  it("doesn't flash offline for a network blip just after reopening, until the server answers", async () => {
    startConnectivity();
    await settle();
    const network = fake.networkListeners.at(-1);
    if (!network) throw new Error("no network listener");
    fake.server.offline = true;
    for (const listener of fake.appListeners) listener("active");
    network({ isConnected: false });
    await settle(5);
    expect(isOnline()).toBe(true);
    // Answered once the network has settled: from then on an outage shows at once.
    fake.server.offline = false;
    reportReachable();
    network({ isConnected: false });
    expect(isOnline()).toBe(false);
  });

  it("distinguishes device offline (no network) from server unreachable (server down)", async () => {
    startConnectivity();
    await settle();
    const network = fake.networkListeners.at(-1);
    if (!network) throw new Error("no network listener");

    // Device network disconnected:
    network({ isConnected: false });
    expect(getConnectivity().status).toBe("offline");
    expect(getConnectivity().reason).toBe("no_network");

    // Device network connected, but server is down (confirmed by repeated probes):
    fake.server.offline = true;
    network({ isConnected: true, isInternetReachable: true });
    await settle(5);
    await probe();
    await probe();
    expect(getConnectivity().status).toBe("offline");
    expect(getConnectivity().reason).toBe("server_unreachable");
  });
});

describe("requests", () => {
  it("throws NetworkError, not a generic error, when the server can't be reached", async () => {
    fake.server.offline = true;
    const error = await apiRequest("/anything", TOKEN).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    // An isolated failure is not "offline" yet; probes confirm it first.
    expect(isOnline()).toBe(true);
  });

  it("reports the status and Retry-After of a refusal", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: "Busy" }), {
        headers: { "Retry-After": "30" },
        status: 503,
      })) as typeof fetch;
    try {
      const error = await apiRequest("/anything", TOKEN).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(503);
      expect((error as ApiError).retryAfterMs).toBe(30_000);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("gives up after its timeout instead of hanging", async () => {
    fake.server.routes.set("GET /slow", () => "hang");
    const started = Date.now();
    const error = await timedFetch("http://api.test/slow", {}, 30).catch((caught) => caught);
    expect(isNetworkError(error)).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("doesn't call the app offline when a slow request times out but the server answers", async () => {
    fake.server.routes.set("GET /slow", () => "hang");
    for (let tries = 0; tries < 4; tries += 1) {
      const error = await timedFetch("http://api.test/slow", {}, 30).catch((caught) => caught);
      expect(error.message).toBe("The server took too long to answer. Please try again.");
    }
    await settle(5);
    expect(isOnline()).toBe(true);
  });

  it("treats a Wi-Fi sign-in page as offline, not as the API's answer", async () => {
    fake.server.portal = true;
    const rest = await apiRequest("/anything", TOKEN).catch((caught) => caught);
    const graph = await graphqlRequest({ query: "{ me { id } }", token: TOKEN }).catch(
      (caught) => caught,
    );
    expect(isNetworkError(rest)).toBe(true);
    expect(isNetworkError(graph)).toBe(true);
  });

  it("marks the app online again on any answer from the server", async () => {
    reportUnreachable();
    await apiRequest("/anything", TOKEN);
    expect(isOnline()).toBe(true);
  });

  it("keeps the server's own refusal as a normal error with its message", async () => {
    fake.server.routes.set("PATCH /orders/1/shipment-status", () => ({
      body: { message: "Invalid delivery OTP" },
      status: 422,
    }));
    const error = await apiRequest("/orders/1/shipment-status", TOKEN, {
      body: "{}",
      method: "PATCH",
    }).catch((caught: Error) => caught);
    expect(isNetworkError(error)).toBe(false);
    expect((error as Error).message).toBe("Invalid delivery OTP");
  });

  it("doesn't wait out a second timeout when the first failure was the network", async () => {
    let tries = 0;
    const failing = () => {
      tries += 1;
      return Promise.reject(new NetworkError());
    };
    await retryOnce(failing).catch(() => undefined);
    expect(tries).toBe(1);
  });
});
