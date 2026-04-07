# CLAUDE.md

## Project Overview

**news-poster** is an AI-powered news aggregation and Facebook posting pipeline built with TypeScript. It fetches trending articles from GNews, curates them with Claude AI, generates captions, and posts to Facebook pages. It supports multiple independent channels with separate languages, topics, schedules, and credentials.

## Tech Stack

- **Runtime:** Node.js (>= 18) with TypeScript (ES2022, ESNext modules)
- **Execution:** `tsx` for direct TypeScript execution (no build step needed)
- **APIs:** GNews API (news), Meta Graph API v21.0 (Facebook posting), Pexels API (image fallback), Claude Code CLI (AI curation and caption writing)
- **Dependencies:** axios, dotenv, node-cron, winston

## Build & Run Commands

- `npm install` -- install dependencies
- `npm run pipeline -- --channel <name>` -- run pipeline once for a channel
- `npm run pipeline -- --channel <name> --dry-run` -- dry run (no Facebook posting)
- `npm run test:post` -- alias for dry-run test
- `npm run scheduler` -- start cron scheduler for all channels
- `npm run build` -- type-check with `tsc --noEmit` (no emit, project uses tsx)

## Architecture

The pipeline runs in 5 sequential stages (with an optional Telegram approval gate before posting):
1. `src/1-news/news-fetcher.ts` -- Fetch headlines from GNews API
2. `src/5-tracking/tracker.ts` (`filterUnposted`) -- Deduplicate against 7-day tracking window
3. `src/1-news/news-curator.ts` -- Claude AI ranks articles by relevance/impact
4. `src/2-content/content-writer.ts` + `src/3-image/image-fetcher.ts` -- Generate caption, resolve image
   - _(optional)_ `src/utils/telegram-approval.ts` -- Send preview to Telegram for manual Approve/Reject
5. `src/4-post/facebook-poster.ts` -- Post to Facebook
6. `src/5-tracking/tracker.ts` (`markAsPosted`) -- Track posted article URLs

Orchestration is in `src/pipeline.ts`. The scheduler (`scheduler/local-scheduler.ts`) loads all `channels/*.env` files and cron-schedules each channel's pipeline.

## Configuration

Two-layer `.env` system:
- Root `.env` -- shared keys (GNEWS_API_KEY, CLAUDE_CODE_PATH, PEXELS_API_KEY, LOG_LEVEL, DRY_RUN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_APPROVAL_TIMEOUT)
- `channels/<name>.env` -- per-channel settings (LANGUAGE, COUNTRY, NEWS_CATEGORIES, TOPIC_FOCUS, FACEBOOK_PAGE_ID, FACEBOOK_ACCESS_TOKEN, POSTING_SCHEDULE, MAX_POSTS_PER_RUN, HASHTAGS)

Config is loaded in `src/config/load-config.ts`. Types are defined in `src/config/types.ts`.

## Code Conventions

- ES modules (`"type": "module"` in package.json); imports use `.js` extensions
- Strict TypeScript with `tsconfig.json` strict mode enabled
- No build output committed; `dist/` is gitignored
- Secrets (`.env`, `channels/*.env`) are gitignored; only `.env.example` files are tracked
- Logging via Winston (`src/utils/logger.ts`); log files go to `logs/`
- Each pipeline stage is in its own numbered directory (`1-news/`, `2-content/`, etc.)
