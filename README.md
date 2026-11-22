# GTA VI Assistant

A spoiler-aware companion for GTA VI. A scheduled job continuously collects tips, secrets, collectibles, special events and trending guides from YouTube, Reddit, news feeds, TikTok (best-effort) and any guide sites you add, then an installable web app (phone Home Screen friendly) lets you browse them with spoiler protection.

## What it does

| Feature | How |
|---|---|
| **No-spoilers mode** | Every item is graded `safe / mild / major` (by Claude when `ANTHROPIC_API_KEY` is set, keyword fallback otherwise). **No spoilers** shows only `safe`; anything ungraded is treated as a spoiler. Reddit's own spoiler flag can only raise the level. Thumbnails are blurred until tapped, and you can mute words (names, places). |
| **Trending** | Engagement velocity (views / score / comments ÷ age^1.25), recomputed every run. |
| **Secrets / collectibles / specials** | Classified per item; a tracker with per-category progress (stored on your device); a **Live** tab for time-limited items with availability windows. |
| **Alerts** | In-app notifications while the app is open, plus phone push through [ntfy](https://ntfy.sh) when it's closed. Pushes never contain spoilers: only `safe` items include their summary. |
| **Stays current** | GitHub Actions runs `pipeline/ingest.mjs` every 30 min and commits refreshed `data/*.json`. The app shows how old the data is and warns when the job stalls. |

## Setup

1. **Merge to your default branch** and enable **Settings → Pages** (deploy from branch, root). Scheduled workflows only run from the default branch.
2. Add **Settings → Secrets and variables → Actions → Secrets** (all optional; each unlocks a source):

   | Secret | Unlocks |
   |---|---|
   | `ANTHROPIC_API_KEY` | Accurate spoiler grading, spoiler-free summaries, availability windows, seed-site extraction. **Strongly recommended.** |
   | `YOUTUBE_API_KEY` | YouTube keyword search + view stats (YouTube Data API v3). Channel RSS works without it. |
   | `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | Reliable Reddit access (app-only OAuth). Unauthenticated Reddit often blocks cloud IPs. |
   | `APIFY_TOKEN` | TikTok hashtag search (see caveat below). |
   | `NTFY_TOPIC` | Phone alerts. Pick a long random topic name and subscribe to it in the ntfy app. Set the repo variable `APP_URL` to your Pages URL so taps open the app. |

3. Run the **Refresh GTA VI content** workflow once manually (Actions tab) to fill the feed.

## Adding your seed site(s)

Edit `config/sources.json`:

```json
"sites": [{ "url": "https://example.com/gta6-guide", "maxPages": 20, "include": "/gta6" }]
```

The job fetches the page (plus up to `maxPages - 1` same-site links matching `include`), respects `robots.txt`, and has Claude extract collectibles and guide entries into `data/collectibles.json` and the feed. It never invents entries — it only records what the page states. Requires `ANTHROPIC_API_KEY`.

Other knobs in the same file: YouTube search queries and channel IDs, subreddits, news RSS feeds, TikTok hashtags / hand-picked video URLs, retention.

## Known limits (please read)

- **TikTok has no open search API.** Hashtag search goes through a paid third-party scraper (Apify) which may conflict with TikTok's terms — it's off unless you set `APIFY_TOKEN`. Without it you can list video URLs by hand in `tiktok.urls`; they're resolved via TikTok's official oEmbed (no view counts).
- **Spoiler grading uses titles and descriptions, not video transcripts or footage.** A video titled innocently can still contain spoilers. Treat No-spoilers mode as strong filtering, not a guarantee; mute words and blurred thumbnails are there for that reason.
- **"Completely current" is bounded by the schedule** (30 min, best effort — GitHub can delay cron) and by API quotas (YouTube search costs 100 units; the default 10 k/day budget is ~100 searches).
- **Not yet verified against live services.** The adapters were written from the public API docs and are covered by tests with mocked responses; they could not be run against the real YouTube, Reddit, TikTok or news endpoints from the build sandbox. Check the **Settings → Sources** panel after the first run: it shows each source's status and errors.
- Collectible data is only as good as the seed sites you give it; nothing is pre-loaded.

## Development

```bash
npm test                       # pipeline + logic unit tests (offline, mocked network)
npm run serve                  # http://localhost:8080
node test/e2e.cjs [shots-dir]  # browser smoke test with fixture data (needs playwright)
npm run ingest                 # one ingestion run (uses env vars above)
```

Layout: `pipeline/` (sources, enrichment, orchestrator) · `app/` (UI + pure logic) · `data/` (generated JSON the app reads) · `config/sources.json` · `test/`.

The previous Global Dance Radio app lives in this repo's git history.
