import {
  type AlertEvent,
  detectEvents,
  type StoredState,
  snapshotsFromRows,
} from "./alertState.js";
import type { Env } from "./env.js";
import { sendPush } from "./push.js";
import { fetchInspectionRows } from "./socrata.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Free-plan Workers get 10ms of CPU per invocation. Each push costs ~0.5ms of
// WebCrypto and each checked restaurant adds JSON parsing, so runs stay small
// and the cron runs often instead.
const CHECK_CHUNK_SIZE = 50;
const MAX_SENDS_PER_RUN = 8;
const RECHECK_AFTER = 6 * HOUR;
const MAX_ATTEMPTS = 6;
const RETRY_BASE = 15 * 60 * 1000;
const RETENTION = 30 * DAY;

interface StateRow extends StoredState {
  camis: string;
  baselined: number;
}

/**
 * Fetches the restaurants' history, records new state, and queues alerts for
 * anyone who followed before detection. Events, deliveries, and state are
 * written in one batch so a crash can't record the state without the alerts.
 */
export async function checkRestaurants(
  env: Env,
  camisList: string[],
  now = Date.now(),
): Promise<void> {
  if (camisList.length === 0) return;
  const rows = await fetchInspectionRows(camisList, env.SOCRATA_APP_TOKEN);
  const snapshots = snapshotsFromRows(rows);

  const placeholders = camisList.map(() => "?").join(",");
  const { results: stateRows } = await env.DB.prepare(
    `SELECT camis, grade, grade_inspection_date, latest_closure_date, baselined
       FROM restaurant_state WHERE camis IN (${placeholders})`,
  )
    .bind(...camisList)
    .all<StateRow>();
  const previousByCamis = new Map(stateRows.map((row) => [row.camis, row]));

  const statements: D1PreparedStatement[] = [];
  for (const camis of camisList) {
    const snapshot = snapshots.get(camis);
    if (!snapshot) {
      // Missing from the dataset isn't evidence of anything; keep any existing baseline.
      statements.push(
        env.DB.prepare(
          `INSERT INTO restaurant_state (camis, baselined, checked_at) VALUES (?, 0, ?)
             ON CONFLICT (camis) DO UPDATE SET checked_at = excluded.checked_at`,
        ).bind(camis, now),
      );
      continue;
    }

    const previous = previousByCamis.get(camis);
    const events: AlertEvent[] = detectEvents(
      previous?.baselined ? previous : null,
      snapshot,
    );
    for (const event of events) {
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO alert_events (id, camis, title, body, detected_at)
             VALUES (?, ?, ?, ?, ?)`,
        ).bind(event.id, event.camis, event.title, event.body, now),
        env.DB.prepare(
          `INSERT OR IGNORE INTO deliveries (event_id, endpoint, next_attempt_at)
             SELECT ?, endpoint, ? FROM follows WHERE camis = ? AND created_at <= ?`,
        ).bind(event.id, now, camis, now),
      );
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO restaurant_state
           (camis, name, grade, grade_inspection_date, latest_closure_date, baselined, checked_at)
           VALUES (?, ?, ?, ?, ?, 1, ?)
           ON CONFLICT (camis) DO UPDATE SET
             name = excluded.name,
             grade = excluded.grade,
             grade_inspection_date = excluded.grade_inspection_date,
             latest_closure_date = excluded.latest_closure_date,
             baselined = 1,
             checked_at = excluded.checked_at`,
      ).bind(
        camis,
        snapshot.name,
        snapshot.grade,
        snapshot.gradeInspectionDate,
        snapshot.latestClosureDate,
        now,
      ),
    );
  }
  await env.DB.batch(statements);
}

async function checkDueRestaurants(env: Env, now: number): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT DISTINCT f.camis AS camis, s.checked_at AS checked_at
       FROM follows f LEFT JOIN restaurant_state s ON s.camis = f.camis
       WHERE s.checked_at IS NULL OR s.checked_at < ?
       ORDER BY s.checked_at IS NOT NULL, s.checked_at
       LIMIT ?`,
  )
    .bind(now - RECHECK_AFTER, CHECK_CHUNK_SIZE)
    .all<{ camis: string }>();

  try {
    await checkRestaurants(
      env,
      results.map((row) => row.camis),
      now,
    );
  } catch (error) {
    console.error("Restaurant check failed", error);
  }
}

interface PendingDelivery {
  event_id: string;
  endpoint: string;
  attempts: number;
  p256dh: string;
  auth: string;
  camis: string;
  title: string;
  body: string;
}

/** Returns how many deliveries were attempted. */
async function sendDueDeliveries(env: Env, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT d.event_id, d.endpoint, d.attempts, s.p256dh, s.auth, e.camis, e.title, e.body
       FROM deliveries d
       JOIN subscriptions s ON s.endpoint = d.endpoint
       JOIN alert_events e ON e.id = d.event_id
       WHERE d.sent_at IS NULL AND d.next_attempt_at <= ?
       ORDER BY d.next_attempt_at
       LIMIT ?`,
  )
    .bind(now, MAX_SENDS_PER_RUN)
    .all<PendingDelivery>();

  for (const delivery of results) {
    const outcome = await sendPush(env, {
      subscription: {
        endpoint: delivery.endpoint,
        keys: { p256dh: delivery.p256dh, auth: delivery.auth },
      },
      payload: {
        title: delivery.title,
        body: delivery.body,
        url: `/restaurant/${delivery.camis}`,
        tag: delivery.event_id,
      },
    });

    let statement: D1PreparedStatement;
    if (outcome === "sent") {
      statement = env.DB.prepare(
        "UPDATE deliveries SET sent_at = ? WHERE event_id = ? AND endpoint = ?",
      ).bind(now, delivery.event_id, delivery.endpoint);
    } else if (outcome === "gone") {
      statement = env.DB.prepare(
        "DELETE FROM subscriptions WHERE endpoint = ?",
      ).bind(delivery.endpoint);
    } else if (outcome === "retry" && delivery.attempts + 1 < MAX_ATTEMPTS) {
      statement = env.DB.prepare(
        `UPDATE deliveries SET attempts = attempts + 1, next_attempt_at = ?
           WHERE event_id = ? AND endpoint = ?`,
      ).bind(
        now + RETRY_BASE * 2 ** delivery.attempts,
        delivery.event_id,
        delivery.endpoint,
      );
    } else {
      statement = env.DB.prepare(
        "DELETE FROM deliveries WHERE event_id = ? AND endpoint = ?",
      ).bind(delivery.event_id, delivery.endpoint);
    }
    // Recorded per send so a run killed by the CPU limit doesn't resend what already went out.
    await statement.run();
  }
  return results.length;
}

async function prune(env: Env, now: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM alert_events WHERE detected_at < ? AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.event_id = alert_events.id AND d.sent_at IS NULL)",
    ).bind(now - RETENTION),
    env.DB.prepare(
      "DELETE FROM restaurant_state WHERE NOT EXISTS (SELECT 1 FROM follows f WHERE f.camis = restaurant_state.camis)",
    ),
  ]);
}

export async function runScheduledAlerts(
  env: Env,
  now = Date.now(),
): Promise<void> {
  const attempted = await sendDueDeliveries(env, now);
  // While the queue is backed up, spend the CPU budget on sending, not finding more to send.
  if (attempted < MAX_SENDS_PER_RUN) await checkDueRestaurants(env, now);
  await prune(env, now);
}
