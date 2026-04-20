# news-poster

AI-powered news aggregation and posting pipeline that fetches trending articles from GNews, curates them using GitHub Copilot (via the GitHub Models API), and automatically posts to Facebook. Supports multiple independent channels, each with its own language, topic focus, posting schedule, and Facebook credentials.

## Pipeline Stages

1. **Fetch** -- Retrieve trending news from multiple sources (GNews → NewsData.io → Google News RSS fallback chain) in both the channel's native language and English
2. **Deduplicate** -- Filter out articles posted in the last 7 days and articles previously rejected via Telegram (30-day window)
3. **Curate** -- GitHub Copilot scores articles by recency and global impact, deduplicates by topic cluster (no repeated stories per run), and ranks by relevance to the channel's topic focus
4. **Generate & Post** -- For each top article: write a caption (GitHub Copilot, with translation if needed), resolve an image (article image → Pexels fallback → link-only), optionally send to Telegram for approval, then post to Facebook
5. **Track** -- Persist posted and rejected article URLs in JSON rolling windows to prevent future duplicates

## Prerequisites

- **Node.js** >= 18
- **GitHub account with Copilot access** -- a GitHub Personal Access Token with `models:read` permission, used to call the GitHub Models API. Get one at [github.com/settings/tokens](https://github.com/settings/tokens)
- **GNews API key** -- free tier gives 100 requests/day. Get one at <https://gnews.io>
- **NewsData.io API key** _(optional)_ -- fallback news source, free tier gives 200 requests/day. Get one at <https://newsdata.io/register>
- **Facebook Page Access Token** -- a long-lived page access token with `pages_manage_posts` and `pages_read_engagement` permissions
- **Pexels API key** _(optional)_ -- used as image fallback. Get one at <https://www.pexels.com/api/>

## Installation

```bash
git clone https://github.com/cristobalbl86/news-poster.git
cd news-poster
npm install
```

## Configuration

The bot uses a two-layer `.env` configuration: a **shared** root `.env` for global keys, and **per-channel** files under `channels/` for channel-specific settings.

### 1. Shared environment (`.env`)

Copy the example and fill in your values:

```bash
cp .env.example .env
```

| Variable              | Required | Description                                                      |
| --------------------- | -------- | ---------------------------------------------------------------- |
| `GNEWS_API_KEY`       | Yes      | GNews API key                                                    |
| `NEWSDATA_API_KEY`    | No       | NewsData.io API key — fallback news source (200 req/day free)    |
| `GITHUB_TOKEN`        | Yes      | GitHub PAT with `models:read` permission — used for the GitHub Models API |
| `COPILOT_MODEL`       | No       | Model to use via GitHub Models API (default: `gpt-4o-mini`)      |
| `COPILOT_TIMEOUT`     | No       | Timeout in ms for Copilot API calls (default: `60000`)           |
| `PEXELS_API_KEY`      | No       | Pexels API key for image fallback                                |
| `LOG_LEVEL`           | No       | Winston log level (default: `info`)                              |
| `LOG_FILE`            | No       | Log file path (default: `./logs/bot.log`)                        |
| `DRY_RUN`             | No       | Set to `true` to skip actual Facebook posting (default: `false`) |

### Telegram Post Approval (optional)

When configured, each generated post is sent to your Telegram chat for manual review before publishing. You receive a message with the article info, caption, and image, along with **Approve** / **Reject** buttons. Only approved posts are published to Facebook. If you don't respond within the timeout (default: 30 minutes), the post is skipped.

Leave the variables blank to disable approval and auto-publish all posts as before.

| Variable                     | Required | Description                                                  |
| ---------------------------- | -------- | ------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`         | No       | Telegram Bot API token                                       |
| `TELEGRAM_CHAT_ID`           | No       | Chat ID where approval messages are sent                     |
| `TELEGRAM_APPROVAL_TIMEOUT`  | No       | Time to wait for a response in ms (default: `1800000` / 30 min) |

#### Step 1 — Create a Telegram Bot

1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Choose a display name (e.g. "News Poster Approvals")
4. Choose a username ending in `bot` (e.g. `news_poster_approval_bot`)
5. BotFather will reply with your **bot token** — it looks like `7123456789:AAHxyz...`
6. Copy the token and set it as `TELEGRAM_BOT_TOKEN` in your `.env`

#### Step 2 — Get your Chat ID

**Option A — Private chat (just you):**

1. Open a chat with your new bot and send any message (e.g. "hello")
2. Open this URL in your browser (replace `YOUR_BOT_TOKEN` with your actual token):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
3. In the JSON response, find `"chat":{"id":123456789,...}` — that number is your chat ID
4. Set it as `TELEGRAM_CHAT_ID` in your `.env`

**Option B — Group chat (multiple reviewers):**

1. Create a Telegram group and add your bot to it
2. Send a message in the group
3. Open the same `getUpdates` URL as above
4. Find `"chat":{"id":-100...}` — group IDs are negative numbers
5. Set that number as `TELEGRAM_CHAT_ID`

#### Step 3 — Test the connection

```bash
curl -s -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "YOUR_CHAT_ID", "text": "Bot connected!"}'
```

You should receive "Bot connected!" in your Telegram chat. After that, run the pipeline and each post will arrive for approval before publishing.

### 2. Channel configuration (`channels/<name>.env`)

Each channel is defined by a file under `channels/`. Copy an example to get started:

```bash
cp channels/epicentro.env.example channels/epicentro.env
# or for an English channel:
cp channels/tech-pulse-en.env.example channels/tech-pulse-en.env
```

| Variable                | Required | Description                                                                                       |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `PAGE_DISPLAY_NAME`     | No       | Human-readable page name (default: filename)                                                      |
| `LANGUAGE`              | No       | Language code for news fetching and caption writing: `es`, `en`, `pt`, etc. (default: `es`)       |
| `COUNTRY`               | No       | Country code to filter GNews sources: `mx`, `us`, `ar`, etc.                                      |
| `NEWS_CATEGORIES`       | No       | Comma-separated list of categories (default: `technology,world`). See below                       |
| `TOPIC_FOCUS`           | No       | Free-text description guiding Copilot curation (e.g. `"AI breakthroughs, startup funding rounds"`) |
| `FACEBOOK_PAGE_ID`      | Yes      | Your Facebook Page ID                                                                             |
| `FACEBOOK_ACCESS_TOKEN` | Yes      | Long-lived Facebook Page access token                                                             |
| `POSTING_SCHEDULE`      | No       | Cron expression for the scheduler (default: `0 */3 * * *` -- every 3 hours)                       |
| `MAX_POSTS_PER_RUN`     | No       | Max articles to post per pipeline run (default: `2`; recommended: `6` for full category coverage) |
| `HASHTAGS`              | No       | Hashtags appended to every post (e.g. `#tech #AI #news`)                                          |

#### Supported news categories

**Real GNews categories:** `general`, `world`, `nation`, `business`, `technology`, `entertainment`, `sports`, `science`, `health`

**Country aliases** (pseudo-categories that fetch general headlines from that country): `mexico`, `latam`, `usa`, `spain`, `colombia`, `chile`, `peru`, `brazil`

**Friendly aliases** (automatically mapped to the correct API category): `ai` → `technology`, `aerospace` → `science`

The pipeline enforces **category spread** — it picks at most one article per category per run, so posts cover different topics rather than repeating the same story.

### Adding a new channel

Create a new file `channels/<name>.env` -- no code changes needed. The scheduler automatically picks up all `channels/*.env` files.

## Usage

### Run the pipeline once for a specific channel

```bash
# Run for the "epicentro" channel
npm run pipeline -- --channel epicentro

# Dry run (no Facebook posting)
npm run pipeline -- --channel epicentro --dry-run

# Shortcut for dry-run testing
npm run test:post
```

### Run the scheduler (continuous, all channels)

The scheduler loads every `channels/*.env` file and runs each channel's pipeline on its configured cron schedule.

```bash
npm run scheduler
```

To keep it running after closing the terminal, use PM2:

```bash
npx pm2 start node --name "news-bot-scheduler" \
  --cwd "$(pwd)" \
  -- node_modules/tsx/dist/cli.mjs scheduler/local-scheduler.ts
```

## Project Structure

```
news-poster/
├── .env.example                  # Shared env vars (API keys, GitHub token, Copilot model)
├── channels/
│   ├── epicentro.env.example      # Example: Spanish channel (Mexico-focused)
│   └── tech-pulse-en.env.example # Example: English channel
├── scheduler/
│   └── local-scheduler.ts        # Cron-based multi-channel scheduler
├── src/
│   ├── pipeline.ts               # Main orchestration (5-stage workflow + category spread)
│   ├── 1-news/
│   │   ├── news-fetcher.ts       # Fetch orchestrator (GNews → NewsData.io → Google RSS)
│   │   ├── news-curator.ts       # Copilot ranking with topic deduplication
│   │   └── sources/
│   │       ├── gnews.ts          # GNews API (primary, 100 req/day free)
│   │       ├── newsdata.ts       # NewsData.io (fallback, 200 req/day free)
│   │       └── google-rss.ts     # Google News RSS (backup, unlimited)
│   ├── 2-content/
│   │   └── content-writer.ts     # Copilot caption generation + translation
│   ├── 3-image/
│   │   └── image-fetcher.ts      # Image resolution (article → Pexels → null)
│   ├── 4-post/
│   │   └── facebook-poster.ts    # Meta Graph API v21.0 posting
│   ├── 5-tracking/
│   │   └── tracker.ts            # Posted (7-day) and rejected (30-day) URL tracking
│   ├── config/
│   │   ├── load-config.ts        # Multi-channel config loader
│   │   └── types.ts              # TypeScript type definitions
│   └── utils/
│       ├── copilot-cli.ts        # GitHub Models API client (Copilot)
│       ├── logger.ts             # Winston logger
│       └── telegram-approval.ts  # Telegram approve/reject flow
├── package.json
└── tsconfig.json
```

## License

MIT
