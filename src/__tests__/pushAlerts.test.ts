import { beforeEach, describe, expect, it, vi } from "vitest";

function setupBrowser(permission: NotificationPermission) {
  const store = new Map<string, string>();
  const requestPermission = vi.fn(async () => "default" as const);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.stubGlobal("Notification", { permission, requestPermission });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 (Macintosh)",
    platform: "MacIntel",
    maxTouchPoints: 0,
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: { getSubscription: async () => null },
      }),
    },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  return { requestPermission };
}

async function loadAlerts() {
  const mod = await import("../pushAlerts.js");
  await mod.refreshAlertsStatus();
  return mod;
}

describe("offerAlertsOnFollow", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("asks for permission on the first follow only", async () => {
    const { requestPermission } = setupBrowser("default");
    const { offerAlertsOnFollow } = await loadAlerts();

    expect(offerAlertsOnFollow()).toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(offerAlertsOnFollow()).toBe(false);
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-enable alerts the user turned off", async () => {
    const { requestPermission } = setupBrowser("granted");
    const { offerAlertsOnFollow } = await loadAlerts();

    expect(offerAlertsOnFollow()).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
