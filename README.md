# EatSafe

A better search interface for [NYC DOHMH restaurant inspection data](https://data.cityofnewyork.us/Health/DOHMH-New-York-City-Restaurant-Inspection-Results/43nn-pn8j).

**[eatsafe.nyc](https://eatsafe.nyc)**

## Features

- Search by name, address, zip code, cuisine, neighborhood, borough, and grade
- Multi-select filters for borough, grade, and community board (neighborhood)
- Word-boundary name matching (searching "Om" finds "Om Restaurant", not "Momofuku")
- Citywide discovery view for recent restaurant closures
- Restaurant inspection history with grade timeline
- Follow restaurants and get push alerts when one is closed by DOHMH or its recorded grade drops
- Dark mode

## Stack

- React + TypeScript + Vite
- Tailwind CSS v4
- Headless UI
- NYC Open Data API (SoQL)
- Cloudflare Worker + D1 for follow alerts (`worker/`), sent with Web Push

## Development

```bash
npm install
npm run dev
```

`npm run dev` serves only the front end. To run the alerts API and cron locally, generate a key pair with `npx @pushforge/builder vapid` and put both halves in `.dev.vars` (`VAPID_PUBLIC_KEY=...` and `VAPID_PRIVATE_JWK=...`; the public key in `wrangler.jsonc` is production's and won't match a local private key), then:

```bash
npx wrangler d1 migrations apply eatsafe --local
npm run build && npx wrangler dev --test-scheduled
curl 'http://localhost:8787/cdn-cgi/handler/scheduled'
```

## Deploy

Pushes to `main` automatically deploy to [eatsafe.nyc](https://eatsafe.nyc) on Cloudflare Workers via GitHub Actions. The workflow applies D1 migrations before deploying. The `VAPID_PRIVATE_JWK` secret must be set with `wrangler secret put`, and its public key goes in `wrangler.jsonc`.
