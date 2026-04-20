# Copilot Instructions

## Commands

```bash
npm run pipeline -- --channel <name>   # run pipeline once for a channel
npm run pipeline -- --channel <name> --dry-run  # skip Facebook posting
npm run test:post                       # dry-run with default channel
npm run scheduler                       # start cron scheduler (all channels)
npm run build                           # type-check only (tsc --noEmit; no emit step)
```

There is no test suite. `npm run build` is the primary correctness check.

## Architecture

**news-poster** is a multi-channel news aggregation → AI curation → Facebook posting pipeline. Each run is orchestrated by `src/pipeline.ts` in 5 stages:

1. **Fetch** (`src/1-news/news-fetcher.ts`) — Tries GNews → NewsData.io → Google RSS in a fallback chain. Fetches in both the channel's native language **and English** to maximize article pool. Articles carry a `sourceLang` field.
2. **Deduplicate** (`src/5-tracking/tracker.ts`) — Filters URLs tracked in `output/posted-articles.json` (7-day window) and `output/rejected-articles.json` (30-day window).
3. **Curate** (`src/1-news/news-curator.ts`) — Calls Claude CLI via `spawnSync` with `--print`. Pre-selects up to 20 articles before sending to Claude; Claude returns scored JSON and topic clusters to prevent duplicate stories per run.
4. **Generate & Post** — For each top article: write caption (`src/2-content/content-writer.ts`), resolve image (`src/3-image/image-fetcher.ts`), optionally gate on Telegram approval (`src/utils/telegram-approval.ts`), then post via Meta Graph API v21.0 (`src/4-post/facebook-poster.ts`).
5. **Track** — `markAsPosted` / `markAsRejected` persist results to `output/`.

**Scheduler** (`scheduler/local-scheduler.ts`) reads all `channels/*.env` files at startup and schedules each channel independently with `node-cron`.

## Configuration

Two-layer `.env` system — **never commit real env files, only `.env.example`**:

- `.env` — shared keys: `GNEWS_API_KEY`, `GITHUB_TOKEN`, `COPILOT_MODEL`, `COPILOT_TIMEOUT`, `PEXELS_API_KEY`, `LOG_LEVEL`, `DRY_RUN`, `NEWSDATA_API_KEY`, `TELEGRAM_*`
- `channels/<name>.env` — per-channel: `FACEBOOK_PAGE_ID`, `FACEBOOK_ACCESS_TOKEN`, `LANGUAGE`, `COUNTRY`, `NEWS_CATEGORIES`, `TOPIC_FOCUS`, `POSTING_SCHEDULE`, `MAX_POSTS_PER_RUN`, `HASHTAGS`

`loadBotConfig(channelName)` in `src/config/load-config.ts` merges both; channel values override shared. Adding a new channel requires only a new `channels/<name>.env` — no code changes.

## Key Conventions

**ES modules with `.js` extensions in imports** — the project uses `"type": "module"`. All internal imports must use `.js` extension even for `.ts` source files (e.g., `import { foo } from './bar.js'`).

**No build output** — `tsx` executes TypeScript directly. Never use `ts-node` or `tsc` to emit files. `dist/` is gitignored.

**GitHub Copilot is called via HTTP, not CLI** — `src/utils/copilot-cli.ts` uses `axios` to POST to the GitHub Models API (`https://models.inference.ai.azure.com/chat/completions`). Use `askCopilot(prompt)` for text and `askCopilotJson<T>(prompt)` for structured JSON. Both are `async`. The JSON helper strips markdown fences and extracts the first JSON object/array automatically. Auth requires `GITHUB_TOKEN` in the environment.

**Tracking files are the dedup source of truth** — `output/posted-articles.json` and `output/rejected-articles.json` are runtime state. Never delete them in production without understanding the consequences (articles will be re-posted).

**Category spread in pipeline** — `pipeline.ts` enforces at most 3 articles per category per run, with a guaranteed minimum of 3 `mexico`-category articles and at least 1 article in the channel's native language. This logic is hardcoded in `pipeline.ts` and assumes the `epicentro` channel's Mexico focus.

**Fallback chain is threshold-gated** — `news-fetcher.ts` only tries the next source if the current total is below `MIN_ARTICLES = 8`. Changing this constant changes when fallback sources activate.

**Winston logger singleton** — `src/utils/logger.ts` exports both `createLogger` (pipeline entry point) and `getLogger` (everywhere else). Call `createLogger` once at pipeline start; all other modules use `getLogger`.
