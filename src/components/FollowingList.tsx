import { Link } from "react-router-dom";
import { unfollowRestaurant, useFollows } from "../follows.js";
import { syncAlerts } from "../pushAlerts.js";
import { AlertsPanel } from "./FollowButton.js";

export default function FollowingList() {
  const follows = useFollows();
  if (follows.length === 0) return null;

  return (
    <section className="max-w-xl mx-auto px-4 pt-10 text-left">
      <h2 className="font-mono text-xs tracking-widest text-zinc-400 dark:text-zinc-500 uppercase mb-3">
        Following
      </h2>
      <ul className="flex flex-col gap-1 mb-4">
        {[...follows]
          .sort((a, b) => a.dba.localeCompare(b.dba))
          .map((f) => (
            <li
              key={f.camis}
              className="flex items-center justify-between gap-3 font-mono text-sm"
            >
              <Link
                to={`/restaurant/${f.camis}`}
                className="text-zinc-700 hover:text-yellow-600 dark:text-zinc-200 dark:hover:text-yellow-400 transition-colors truncate"
              >
                {f.dba}
              </Link>
              <button
                type="button"
                onClick={() => {
                  unfollowRestaurant(f.camis);
                  syncAlerts();
                }}
                aria-label={`Unfollow ${f.dba}`}
                className="text-xs text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 cursor-pointer"
              >
                Unfollow
              </button>
            </li>
          ))}
      </ul>
      <AlertsPanel />
    </section>
  );
}
