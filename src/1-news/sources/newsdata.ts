// =============================================================
// NewsData.io source — https://newsdata.io/documentation
// Free tier: 200 requests/day, supports timeframe param
// =============================================================

import axios from 'axios';
import { getLogger } from '../../utils/logger.js';
import type { NewsArticle } from '../../config/types.js';

const NEWSDATA_BASE = 'https://newsdata.io/api/1/latest';

// Map our categories to NewsData.io categories
const CATEGORY_MAP: Record<string, string> = {
  technology: 'technology',
  world: 'world',
  nation: 'politics',
  business: 'business',
  science: 'science',
  health: 'health',
  entertainment: 'entertainment',
  sports: 'sports',
  general: 'top',
};

// Map our country aliases to NewsData country codes
const COUNTRY_MAP: Record<string, string> = {
  mexico: 'mx',
  mx: 'mx',
  latam: 'ar',
  usa: 'us',
  us: 'us',
  spain: 'es',
  colombia: 'co',
  chile: 'cl',
  peru: 'pe',
  brazil: 'br',
};

interface NewsDataArticle {
  title: string;
  description: string | null;
  content: string | null;
  link: string;
  image_url: string | null;
  pubDate: string;
  source_name: string;
  source_url: string;
  category: string[];
}

interface NewsDataResponse {
  status: string;
  totalResults: number;
  results: NewsDataArticle[];
  nextPage?: string;
}

function toNewsArticle(raw: NewsDataArticle, category: string, lang: string): NewsArticle {
  return {
    title: raw.title || '',
    description: raw.description || '',
    content: raw.content || '',
    url: raw.link,
    image: raw.image_url || null,
    publishedAt: raw.pubDate,
    source: { name: raw.source_name || 'Unknown', url: raw.source_url || '' },
    category,
    sourceLang: lang,
    provider: 'newsdata',
  };
}

export async function fetchFromNewsData(
  apiKey: string,
  categories: string[],
  lang: string,
  country?: string,
  fromHoursAgo: number = 24,
): Promise<NewsArticle[]> {
  const log = getLogger();
  const results: NewsArticle[] = [];

  // Resolve categories
  const ndCategories = categories
    .map(c => CATEGORY_MAP[c.toLowerCase().trim()])
    .filter(Boolean);

  // Resolve country — use explicit country aliases first, then channel country
  const countryAliases = categories
    .map(c => COUNTRY_MAP[c.toLowerCase().trim()])
    .filter(Boolean);
  const ndCountry = countryAliases[0] || (country ? COUNTRY_MAP[country] || country : undefined);

  // NewsData supports comma-separated categories in one request
  const categoryParam = [...new Set(ndCategories)].join(',') || 'top';

  try {
    const params: Record<string, string | number> = {
      apikey: apiKey,
      language: lang,
      category: categoryParam,
      size: 10,
    };
    if (ndCountry) params.country = ndCountry;
    if (fromHoursAgo) params.timeframe = fromHoursAgo;

    const response = await axios.get<NewsDataResponse>(NEWSDATA_BASE, {
      params,
      timeout: 15000,
    });

    const articles = (response.data.results || [])
      .filter(a => a.title)
      .map(a => toNewsArticle(a, a.category?.[0] || 'general', lang));

    log.info(`  [newsdata/${lang}] ${articles.length} articles (categories: ${categoryParam})`);
    results.push(...articles);
  } catch (err: any) {
    log.error(`  [newsdata/${lang}] Failed: ${err.message}`);
  }

  return results;
}
