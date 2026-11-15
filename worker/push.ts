import { buildPushHTTPRequest } from "@pushforge/builder";
import type { Env } from "./env.js";

export interface PushTarget {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  payload: { title: string; body: string; url: string; tag: string };
}

export type PushOutcome = "sent" | "gone" | "retry" | "failed";

export async function sendPush(
  env: Env,
  target: PushTarget,
): Promise<PushOutcome> {
  try {
    const { endpoint, headers, body } = await buildPushHTTPRequest({
      privateJWK: env.VAPID_PRIVATE_JWK,
      subscription: target.subscription,
      message: {
        payload: target.payload,
        adminContact: env.VAPID_SUBJECT,
        options: { urgency: "normal" },
      },
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
    });
    if (response.ok) return "sent";
    if (response.status === 404 || response.status === 410) return "gone";
    if (response.status === 429 || response.status >= 500) return "retry";
    console.error("Push rejected", response.status, await response.text());
    return "failed";
  } catch (error) {
    console.error("Push send failed", error);
    return "retry";
  }
}
