# news-poster

AI-powered news aggregation and posting pipeline that fetches trending articles from GNews, curates them using Claude AI, and automatically posts to Facebook. Supports multiple independent channels, each with its own language, topic focus, posting schedule, and Facebook credentials.

## Pipeline Stages

1. **Fetch** -- Retrieve trending news from GNews API by category and language
2. **Deduplicate** -- Filter out articles already posted in the last 7 days
3. **Curate** -- Claude AI ranks articles by impact, virality, and relevance to the channel's topic focus
4. **Generate & Post** -- For each top article: write a caption (Claude), resolve an image (article image -> Pexels fallback -> link-only), post to Facebook, and track the URL
5. **Track** -- Persist posted articles in a JSON rolling window (max 1000 entries) to prevent duplicates

## Prerequisites

- **Node.js** >= 18
- **Claude Code CLI** installed and available in your PATH ([docs](https://docs.anthropic.com/en/docs/claude-code))
- **GNews API key** -- free tier gives 100 requests/day. Get one at <https://gnews.io>
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
| `CLAUDE_CODE_PATH`    | No       | Path to the Claude CLI binary (default: `claude`)                |
| `CLAUDE_CODE_TIMEOUT` | No       | Timeout in ms for Claude calls (default: `60000`)                |
| `PEXELS_API_KEY`      | No       | Pexels API key for image fallback                                |
| `LOG_LEVEL`           | No       | Winston log level (default: `info`)                              |
| `LOG_FILE`            | No       | Log file path (default: `./logs/bot.log`)                        |
| `DRY_RUN`             | No       | Set to `true` to skip actual Facebook posting (default: `false`) |

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
| `TOPIC_FOCUS`           | No       | Free-text description guiding Claude curation (e.g. `"AI breakthroughs, startup funding rounds"`) |
| `FACEBOOK_PAGE_ID`      | Yes      | Your Facebook Page ID                                                                             |
| `FACEBOOK_ACCESS_TOKEN` | Yes      | Long-lived Facebook Page access token                                                             |
| `POSTING_SCHEDULE`      | No       | Cron expression for the scheduler (default: `0 */3 * * *` -- every 3 hours)                       |
| `MAX_POSTS_PER_RUN`     | No       | Max articles to post per pipeline run (default: `2`)                                              |
| `HASHTAGS`              | No       | Hashtags appended to every post (e.g. `#tech #AI #news`)                                          |

#### Supported news categories

**Real GNews categories:** `general`, `world`, `nation`, `business`, `technology`, `entertainment`, `sports`, `science`, `health`

**Country aliases** (pseudo-categories that fetch general headlines from that country): `mexico`, `latam`, `usa`, `spain`, `colombia`, `chile`, `peru`, `brazil`

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
├── .env.example                  # Shared env vars (API keys, Claude path)
├── channels/
│   ├── epicentro.env.example      # Example: Spanish channel (Mexico-focused)
│   └── tech-pulse-en.env.example # Example: English channel
├── scheduler/
│   └── local-scheduler.ts        # Cron-based multi-channel scheduler
├── src/
│   ├── pipeline.ts               # Main orchestration (5-stage workflow)
│   ├── 1-news/
│   │   ├── news-fetcher.ts       # GNews API integration
│   │   └── news-curator.ts       # Claude AI article ranking
│   ├── 2-content/
│   │   └── content-writer.ts     # Claude AI caption generation
│   ├── 3-image/
│   │   └── image-fetcher.ts      # Image resolution (article -> Pexels -> null)
│   ├── 4-post/
│   │   └── facebook-poster.ts    # Meta Graph API v21.0 posting
│   ├── 5-tracking/
│   │   └── tracker.ts            # Dedup tracking (7-day rolling JSON)
│   ├── config/
│   │   ├── load-config.ts        # Multi-channel config loader
│   │   └── types.ts              # TypeScript type definitions
│   └── utils/
│       ├── claude-code-cli.ts    # Claude Code CLI wrapper
│       └── logger.ts             # Winston logger
├── package.json
└── tsconfig.json
```

## License

MIT
