export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ALERTS_RATE_LIMITER: RateLimit;
  VAPID_PUBLIC_KEY: string;
  VAPID_SUBJECT: string;
  VAPID_PRIVATE_JWK: string;
  SOCRATA_APP_TOKEN?: string;
}
