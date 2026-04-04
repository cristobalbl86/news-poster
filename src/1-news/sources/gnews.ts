// =============================================================
// GNews source — https://gnews.io/docs/v4
// Free tier: 100 requests/day
// =============================================================

import axios from 'axios';
import { getLogger } from '../../utils/logger.js';
import type { NewsArticle } from '../../config/types.js';

const GNEWS_BASE = 'https://gnews.io/api/v4';

const VALID_CATEGORIES = new Set([
  'general', 'world', 'nation', 'business', 'technology',
  'entertainment', 'sports', 'science', 'health',
]);

const COUNTRY_ALIASES: Record<string, string> = {
  mexico: 'mx',
  latam: 'ar',
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

function toNewsArticle(raw: GNewsArticle, category: string, lang: string): NewsArticle {
  return {
    title: raw.title,
    description: raw.description || '',
    content: raw.content || '',
    url: raw.url,
    image: raw.image || null,
    publishedAt: raw.publishedAt,
    source: raw.source,
    category,
    sourceLang: lang,
    provider: 'gnews',
  };
}

export function resolveCategory(cat: string): { type: 'category'; value: string; country?: undefined } | { type: 'country'; value: string } | null {
  const catLower = cat.toLowerCase().trim();
  if (COUNTRY_ALIASES[catLower]) return { type: 'country', value: COUNTRY_ALIASES[catLower] };
  if (VALID_CATEGORIES.has(catLower)) return { type: 'category', value: catLower };
  return null;
}

export async function fetchFromGNews(
  apiKey: string,
  categories: string[],
  lang: string,
  country?: string,
  maxPerCategory: number = 10,
  fromHoursAgo: number = 24,
): Promise<NewsArticle[]> {
  const log = getLogger();
  const results: NewsArticle[] = [];

  for (const cat of categories) {
    const resolved = resolveCategory(cat);
    if (!resolved) {
      log.warn(`[gnews] Unknown category "${cat}" — skipping`);
      continue;
    }

    try {
      if (results.length > 0) await new Promise(r => setTimeout(r, 1000));

      let raw: GNewsArticle[];
      if (resolved.type === 'country') {
        raw = await fetchHeadlines(apiKey, lang, { country: resolved.value, max: maxPerCategory, fromHoursAgo });
      } else {
        raw = await fetchHeadlines(apiKey, lang, { category: resolved.value, country, max: maxPerCategory, fromHoursAgo });
      }

      const articles = raw.map(a => toNewsArticle(a, cat.toLowerCase().trim(), lang));
      log.info(`  [gnews/${lang}] ${articles.length} articles from "${cat}"`);
      results.push(...articles);
    } catch (err: any) {
      log.error(`  [gnews/${lang}] Failed "${cat}": ${err.message}`);
    }
  }

  return results;
}
