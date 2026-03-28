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
  options: { category?: string; country?: string; max?: number }
): Promise<GNewsArticle[]> {
  const params: Record<string, string | number> = {
    apikey: apiKey,
    lang,
    max: options.max ?? 10,
  };

  if (options.category) params.category = options.category;
  if (options.country) params.country = options.country;

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
  maxPerCategory: number = 10
): Promise<NewsArticle[]> {
  const log = getLogger();
  const results: NewsArticle[] = [];

  for (const cat of categories) {
    const catLower = cat.toLowerCase().trim();

    try {
      log.info(`Fetching trending "${catLower}" news (lang=${language})...`);
      let rawArticles: GNewsArticle[] = [];

      if (COUNTRY_ALIASES[catLower]) {
        // Pseudo-category: fetch general headlines from that country
        rawArticles = await fetchHeadlines(apiKey, language, {
          country: COUNTRY_ALIASES[catLower],
          max: maxPerCategory,
        });
      } else if (VALID_CATEGORIES.has(catLower)) {
        // Real GNews category
        rawArticles = await fetchHeadlines(apiKey, language, {
          category: catLower,
          country,
          max: maxPerCategory,
        });
      } else {
        log.warn(`Unknown category "${catLower}" — skipping. Valid: ${[...VALID_CATEGORIES].join(', ')}, ${Object.keys(COUNTRY_ALIASES).join(', ')}`);
        continue;
      }

      const articles = rawArticles.map(a => toNewsArticle(a, catLower));
      log.info(`  → ${articles.length} articles from "${catLower}"`);
      results.push(...articles);

      // Respect rate limits
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      log.error(`Failed to fetch "${catLower}" news: ${err.message}`);
    }
  }

  // Sort newest first
  results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return results;
}
