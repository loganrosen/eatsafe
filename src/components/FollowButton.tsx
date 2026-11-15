import type { ReactNode } from "react";
import {
  followRestaurant,
  unfollowRestaurant,
  useFollows,
} from "../follows.js";
import {
  disableAlerts,
  enableAlerts,
  offerAlertsOnFollow,
  syncAlerts,
  useAlerts,
} from "../pushAlerts.js";

const MAX_FOLLOWS = 50;

const linkCls =
  "font-mono text-xs text-yellow-600 hover:text-yellow-500 transition-colors dark:text-yellow-400 dark:hover:text-yellow-300 cursor-pointer disabled:opacity-50 disabled:cursor-default";

export function FollowButton({ camis, dba }: { camis: string; dba: string }) {
  const follows = useFollows();
  const following = follows.some((f) => f.camis === camis);
  const atLimit = !following && follows.length >= MAX_FOLLOWS;

  return (
    <button
      type="button"
      disabled={atLimit}
      title={
        atLimit
          ? `You can follow up to ${MAX_FOLLOWS} restaurants`
          : following
            ? "Stop following"
            : "Follow this restaurant"
      }
      aria-pressed={following}
      onClick={() => {
        if (following) {
          unfollowRestaurant(camis);
          syncAlerts();
        } else {
          followRestaurant(camis, dba);
          if (!offerAlertsOnFollow()) syncAlerts();
        }
      }}
      className={linkCls}
    >
      {following ? "★ Following" : "☆ Follow"}
    </button>
  );
}

export function AlertsPanel() {
  const { status, busy, error } = useAlerts();
  if (status === "checking") return null;

  const description =
    "Get a notification if a restaurant you follow is closed by the Health Department or its recorded letter grade drops. Alerts can arrive a few days after the inspection.";

  let content: ReactNode;
  if (status === "on") {
    content = (
      <>
        <span>
          🔔 Alerts are on for the restaurants you follow on this device.
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => disableAlerts()}
          className={linkCls}
        >
          Turn off
        </button>
      </>
    );
  } else if (status === "off") {
    content = (
      <>
        <span>{description}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => enableAlerts()}
          className={linkCls}
        >
          {busy ? "Turning on…" : "Turn on alerts"}
        </button>
      </>
    );
  } else if (status === "needs-install") {
    content = (
      <span>
        {description} On iPhone and iPad, add eatsafe to your Home Screen (Share
        → Add to Home Screen) and open it from there to turn alerts on.
      </span>
    );
  } else if (status === "denied") {
    content = (
      <span>
        Notifications are blocked for eatsafe. Allow them in your browser's site
        settings to get alerts.
      </span>
    );
  } else {
    content = <span>This browser doesn't support notifications.</span>;
  }

  return (
    <div className="mb-6 rounded border border-zinc-200 dark:border-zinc-800 px-4 py-3 font-mono text-xs text-zinc-600 dark:text-zinc-300 flex flex-col gap-2 items-start">
      {content}
      {error && <span className="text-red-500">{error}</span>}
    </div>
  );
}
