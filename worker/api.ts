import { checkRestaurants } from "./alerts.js";
import type { Env } from "./env.js";

export const MAX_FOLLOWS = 50;
const MAX_BODY_BYTES = 16 * 1024;
const CAMIS_PATTERN = /^\d{5,10}$/;
const KEY_PATTERN = /^[A-Za-z0-9_-]+={0,2}$/;

// Only real browser push services, so the cron job can't be pointed at arbitrary URLs.
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
];

interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

class BadRequest extends Error {}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1024) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port || url.username) return false;
  return PUSH_HOST_SUFFIXES.some(
    (suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`),
  );
}

function parseSubscription(value: unknown): SubscriptionInput {
  const sub = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;
  if (!sub || typeof sub !== "object") {
    throw new BadRequest("Missing subscription");
  }
  if (!isAllowedPushEndpoint(sub.endpoint)) {
    throw new BadRequest("Unsupported push endpoint");
  }
  const { p256dh, auth } = sub.keys ?? {};
  if (
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    p256dh.length > 128 ||
    auth.length > 64 ||
    !KEY_PATTERN.test(p256dh) ||
    !KEY_PATTERN.test(auth)
  ) {
    throw new BadRequest("Invalid subscription keys");
  }
  return { endpoint: sub.endpoint, p256dh, auth };
}

export function parseFollows(value: unknown): string[] {
  if (!Array.isArray(value)) throw new BadRequest("follows must be an array");
  const follows = [...new Set(value)];
  if (follows.length > MAX_FOLLOWS) {
    throw new BadRequest(`You can follow up to ${MAX_FOLLOWS} restaurants`);
  }
  for (const camis of follows) {
    if (typeof camis !== "string" || !CAMIS_PATTERN.test(camis)) {
      throw new BadRequest("Invalid restaurant ID");
    }
  }
  return follows as string[];
}

async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new BadRequest("Expected JSON");
  }
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new BadRequest("Body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequest("Invalid JSON");
  }
}

async function putSubscription(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const body = (await readJson(request)) as {
    subscription?: unknown;
    follows?: unknown;
  };
  const subscription = parseSubscription(body?.subscription);
  const follows = parseFollows(body?.follows);
  const now = Date.now();

  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO subscriptions (endpoint, p256dh, auth, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET
           p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
    ).bind(
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      now,
      now,
    ),
  ];
  if (follows.length === 0) {
    statements.push(
      env.DB.prepare("DELETE FROM follows WHERE endpoint = ?").bind(
        subscription.endpoint,
      ),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `DELETE FROM follows WHERE endpoint = ?
           AND camis NOT IN (SELECT value FROM json_each(?))`,
      ).bind(subscription.endpoint, JSON.stringify(follows)),
      env.DB.prepare(
        `INSERT OR IGNORE INTO follows (endpoint, camis, created_at)
           SELECT ?, value, ? FROM json_each(?)`,
      ).bind(subscription.endpoint, now, JSON.stringify(follows)),
    );
  }
  await env.DB.batch(statements);

  // Record a baseline now so a change between following and the next cron run isn't missed.
  if (follows.length > 0) {
    const { results } = await env.DB.prepare(
      `SELECT value AS camis FROM json_each(?)
         WHERE value NOT IN (SELECT camis FROM restaurant_state WHERE baselined = 1)`,
    )
      .bind(JSON.stringify(follows))
      .all<{ camis: string }>();
    const unseen = results.map((row) => row.camis);
    if (unseen.length > 0) {
      ctx.waitUntil(
        checkRestaurants(env, unseen).catch((error) =>
          console.error("Baseline check failed", error),
        ),
      );
    }
  }

  return json({ ok: true, follows: follows.length });
}

async function deleteSubscription(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = (await readJson(request)) as { endpoint?: unknown };
  if (!isAllowedPushEndpoint(body?.endpoint)) {
    throw new BadRequest("Unsupported push endpoint");
  }
  await env.DB.prepare("DELETE FROM subscriptions WHERE endpoint = ?")
    .bind(body.endpoint)
    .run();
  return json({ ok: true });
}

export async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/alerts/config" && request.method === "GET") {
    return json({
      vapidPublicKey: env.VAPID_PUBLIC_KEY,
      maxFollows: MAX_FOLLOWS,
    });
  }

  if (pathname !== "/api/alerts/subscription") {
    return json({ error: "Not found" }, 404);
  }
  if (request.method !== "PUT" && request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, 405);
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Forbidden" }, 403);
  }
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const { success } = await env.ALERTS_RATE_LIMITER.limit({ key: ip });
  if (!success) return json({ error: "Too many requests" }, 429);

  try {
    return request.method === "PUT"
      ? await putSubscription(request, env, ctx)
      : await deleteSubscription(request, env);
  } catch (error) {
    if (error instanceof BadRequest) {
      return json({ error: error.message }, 400);
    }
    throw error;
  }
}
