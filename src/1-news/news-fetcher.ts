// =============================================================
// News Fetcher — GNews API
//
// Fetches trending news per channel config. ALL requests use the
// channel's configured language (no hardcoded English).
//
// Supports real GNews categories: technology, world, science,
// business, entertainment, health, sports, nation
//
// Also supports pseudo-categories that map to country filters:
//   "mexico" → country=mx, "latam" → country=ar (etc.)
//
// GNews free tier: 100 requests/day
// API docs: https://gnews.io/docs/v4
// =============================================================

import axios from 'axios';
import { getLogger } from '../utils/logger.js';
import type { NewsArticle, NewsCategoryOrAlias } from '../config/types.js';

const GNEWS_BASE = 'https://gnews.io/api/v4';

// Real GNews categories
const VALID_CATEGORIES = new Set([
  'general', 'world', 'nation', 'business', 'technology',
  'entertainment', 'sports', 'science', 'health',
]);

// Pseudo-categories that map to country filters
const COUNTRY_ALIASES: Record<string, string> = {
  mexico: 'mx',
  latam: 'ar',    // Argentina as Latin America proxy
  usa: 'us',
  spain: 'es',
  colombia: 'co',
  chile: 'cl',
  peru: 'pe',
  brazil: 'br',
};

interface GNewsArticle {
  title: string;
  description: string;
  content: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: { name: string; url: string };
}

interface GNewsResponse {
  totalArticles: number;
  articles: GNewsArticle[];
}

async function fetchHeadlines(
  apiKey: string,
  lang: string,
  options: { category?: string; country?: string; max?: number; fromHoursAgo?: number }
): Promise<GNewsArticle[]> {
  const params: Record<string, string | number> = {
    apikey: apiKey,
    lang,
    max: options.max ?? 10,
  };

  if (options.category) params.category = options.category;
  if (options.country) params.country = options.country;
  if (options.fromHoursAgo) {
    const from = new Date(Date.now() - options.fromHoursAgo * 60 * 60 * 1000);
    params.from = from.toISOString();
  }

  const response = await axios.get<GNewsResponse>(`${GNEWS_BASE}/top-headlines`, {
    params,
    timeout: 15000,
  });
  return response.data.articles || [];
}

function toNewsArticle(raw: GNewsArticle, categoryLabel: string): NewsArticle {
  return {
    title: raw.title,
    description: raw.description || '',
    content: raw.content || '',
    url: raw.url,
    image: raw.image || null,
    publishedAt: raw.publishedAt,
    source: raw.source,
    category: categoryLabel,
  };
}

/**
 * Fetch trending news for all configured categories.
 *
 * @param apiKey     GNews API key
 * @param categories Array of category names or country aliases
 * @param language   Channel language (e.g. "es", "en") — used for ALL requests
 * @param country    Optional default country filter from channel config
 * @param maxPerCategory  Max articles per category request
 */
export async function fetchTrendingNews(
  apiKey: string,
  categories: NewsCategoryOrAlias[],
  language: string,
  country?: string,
  maxPerCategory: number = 10,
  fromHoursAgo: number = 6
): Promise<NewsArticle[]> {
  const log = getLogger();

  // Build fetch tasks for all categories
  const fetchTasks = categories.map(cat => {
    const catLower = cat.toLowerCase().trim();

    if (COUNTRY_ALIASES[catLower]) {
      return { catLower, promise: fetchHeadlines(apiKey, language, {
        country: COUNTRY_ALIASES[catLower],
        max: maxPerCategory,
        fromHoursAgo,
      })};
    } else if (VALID_CATEGORIES.has(catLower)) {
      return { catLower, promise: fetchHeadlines(apiKey, language, {
        category: catLower,
        country,
        max: maxPerCategory,
        fromHoursAgo,
      })};
    } else {
      log.warn(`Unknown category "${catLower}" — skipping. Valid: ${[...VALID_CATEGORIES].join(', ')}, ${Object.keys(COUNTRY_ALIASES).join(', ')}`);
      return null;
    }
  }).filter(Boolean) as { catLower: string; promise: Promise<GNewsArticle[]> }[];

  log.info(`Fetching ${fetchTasks.length} categories in parallel (lang=${language}, last ${fromHoursAgo}h)...`);

  // Fetch all categories in parallel
  const settled = await Promise.allSettled(fetchTasks.map(t => t.promise));

  const results: NewsArticle[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < settled.length; i++) {
    const { catLower } = fetchTasks[i];
    const outcome = settled[i];

    if (outcome.status === 'fulfilled') {
      const articles = outcome.value.map(a => toNewsArticle(a, catLower));
      // Deduplicate by URL across categories
      let added = 0;
      for (const article of articles) {
        if (!seenUrls.has(article.url)) {
          seenUrls.add(article.url);
          results.push(article);
          added++;
        }
      }
      log.info(`  → ${added} unique articles from "${catLower}" (${outcome.value.length - added} dupes skipped)`);
    } else {
      log.error(`Failed to fetch "${catLower}" news: ${outcome.reason?.message || outcome.reason}`);
    }
  }

  // Sort newest first
  results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return results;
}
