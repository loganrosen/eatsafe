import { useEffect, useSyncExternalStore } from "react";
import { getFollows } from "./follows.js";

export type AlertsStatus =
  | "checking"
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on";

interface AlertsState {
  status: AlertsStatus;
  busy: boolean;
  error: string | null;
}

let state: AlertsState = { status: "checking", busy: false, error: null };
const listeners = new Set<() => void>();

function setState(next: Partial<AlertsState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function getRegistration(): Promise<
  ServiceWorkerRegistration | undefined
> {
  if (!("serviceWorker" in navigator)) return undefined;
  // On a first visit the PWA plugin registers the worker after load; dev builds never do.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<undefined>((resolve) => setTimeout(resolve, 5000)),
  ]);
}

async function getSubscription(): Promise<PushSubscription | null> {
  const registration = await getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // fall through
  }
  return `Alerts server returned HTTP ${response.status}`;
}

async function sendFollows(subscription: PushSubscription): Promise<void> {
  const response = await fetch("/api/alerts/subscription", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subscription: subscription.toJSON(),
      follows: getFollows().map((f) => f.camis),
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function refreshAlertsStatus(): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("PushManager" in window)
  ) {
    setState({
      status: isIos() && !isStandalone() ? "needs-install" : "unsupported",
    });
    return;
  }
  if (isIos() && !isStandalone()) {
    setState({ status: "needs-install" });
    return;
  }
  if (Notification.permission === "denied") {
    setState({ status: "denied" });
    return;
  }
  try {
    const registration = await getRegistration();
    if (!registration) {
      setState({ status: "unsupported" });
      return;
    }
    const subscription = await registration.pushManager.getSubscription();
    setState({
      status:
        subscription && Notification.permission === "granted" ? "on" : "off",
    });
  } catch {
    setState({ status: "unsupported" });
  }
}

/** Must be called from a click handler; Safari only prompts on a user gesture. */
export async function enableAlerts(): Promise<void> {
  setState({ busy: true, error: null });
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setState({ status: permission === "denied" ? "denied" : "off" });
      return;
    }
    const registration = await getRegistration();
    if (!registration) throw new Error("Alerts aren't available here.");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const config = await fetch("/api/alerts/config");
      if (!config.ok) throw new Error(await readError(config));
      const { vapidPublicKey } = (await config.json()) as {
        vapidPublicKey: string;
      };
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(vapidPublicKey),
      });
    }
    await sendFollows(subscription);
    setState({ status: "on" });
  } catch (error) {
    setState({ error: (error as Error).message || "Couldn't turn on alerts." });
  } finally {
    setState({ busy: false });
  }
}

export async function disableAlerts(): Promise<void> {
  setState({ busy: true, error: null });
  try {
    const subscription = await getSubscription();
    if (subscription) {
      const response = await fetch("/api/alerts/subscription", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      if (!response.ok) throw new Error(await readError(response));
      await subscription.unsubscribe();
    }
    setState({ status: "off" });
  } catch (error) {
    setState({
      error: (error as Error).message || "Couldn't turn off alerts.",
    });
  } finally {
    setState({ busy: false });
  }
}

/** Pushes the current follow list to the server if this device has alerts on. */
export async function syncAlerts(): Promise<void> {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const subscription = await getSubscription();
    if (!subscription) return;
    await sendFollows(subscription);
    setState({ error: null });
  } catch (error) {
    setState({
      error: `Couldn't update alerts: ${(error as Error).message}`,
    });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAlerts(): AlertsState {
  useEffect(() => {
    if (state.status === "checking") refreshAlertsStatus();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}
