// =============================================================
// Config loader — merges .env (shared) + channels/{name}.env
//
// Multi-channel: each channel has its own language, country,
// topic focus, categories, and Facebook credentials.
// =============================================================

import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, readdirSync } from 'fs';
import type { BotConfig, NewsCategoryOrAlias } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');

function loadEnvFile(filePath: string): Record<string, string> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      vars[key] = val;
    }
    return vars;
  } catch {
    return {};
  }
}

export function loadBotConfig(channelName: string): BotConfig {
  // Load shared .env first (API keys, Claude path, Pexels, etc.)
  loadDotenv({ path: resolve(ROOT, '.env') });

  // Load channel-specific env (channel values override shared)
  const channelVars = loadEnvFile(resolve(ROOT, `channels/${channelName}.env`));
  for (const [k, v] of Object.entries(channelVars)) {
    process.env[k] = v;
  }

  const e = process.env;

  const gnewsApiKey = e.GNEWS_API_KEY;
  if (!gnewsApiKey) throw new Error('GNEWS_API_KEY is required in .env');

  const facebookPageId = e.FACEBOOK_PAGE_ID;
  if (!facebookPageId) throw new Error('FACEBOOK_PAGE_ID is required in channels config');

  const facebookAccessToken = e.FACEBOOK_ACCESS_TOKEN;
  if (!facebookAccessToken) throw new Error('FACEBOOK_ACCESS_TOKEN is required in channels config');

  const rawCategories = (e.NEWS_CATEGORIES || 'technology,world').split(',');
  const newsCategories: NewsCategoryOrAlias[] = rawCategories.map(c => c.trim());

  return {
    pageName: channelName,
    pageDisplayName: e.PAGE_DISPLAY_NAME || channelName,
    language: e.LANGUAGE || 'es',
    country: e.COUNTRY || undefined,
    topicFocus: e.TOPIC_FOCUS || 'trending tech and world news',

    facebookPageId,
    facebookAccessToken,

    postingSchedule: e.POSTING_SCHEDULE || '0 */3 * * *',
    maxPostsPerRun: parseInt(e.MAX_POSTS_PER_RUN || '2', 10),

    newsCategories,
    hashtags: e.HASHTAGS || '',

    gnewsApiKey,
    pexelsApiKey: e.PEXELS_API_KEY,
    claudeCodePath: e.CLAUDE_CODE_PATH || 'claude',
    claudeCodeTimeout: parseInt(e.CLAUDE_CODE_TIMEOUT || '60000', 10),
    logLevel: e.LOG_LEVEL || 'info',
    logFile: e.LOG_FILE || './logs/bot.log',
    dryRun: e.DRY_RUN === 'true',
  };
}

export function loadAllChannels(): string[] {
  try {
    return readdirSync(resolve(ROOT, 'channels'))
      .filter(f => f.endsWith('.env') && !f.endsWith('.env.example'))
      .map(f => f.replace('.env', ''));
  } catch {
    return [];
  }
}
