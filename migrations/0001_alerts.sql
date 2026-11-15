CREATE TABLE subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE follows (
  endpoint TEXT NOT NULL REFERENCES subscriptions(endpoint) ON DELETE CASCADE,
  camis TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (endpoint, camis)
);
CREATE INDEX follows_camis ON follows(camis);

CREATE TABLE restaurant_state (
  camis TEXT PRIMARY KEY,
  name TEXT,
  grade TEXT,
  grade_inspection_date TEXT,
  latest_closure_date TEXT,
  -- 0 when the restaurant wasn't in the dataset at the last check, so no baseline exists yet.
  baselined INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TABLE alert_events (
  id TEXT PRIMARY KEY,
  camis TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  detected_at INTEGER NOT NULL
);

CREATE TABLE deliveries (
  event_id TEXT NOT NULL REFERENCES alert_events(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL REFERENCES subscriptions(endpoint) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  sent_at INTEGER,
  PRIMARY KEY (event_id, endpoint)
);
CREATE INDEX deliveries_pending ON deliveries(sent_at, next_attempt_at);
