// =============================================================
// News Fetcher — Multi-source orchestrator
//
// Fetches news from multiple sources with fallback chain:
//   1. GNews (primary) — es + en
//   2. NewsData.io (fallback) — es + en
//   3. Google News RSS (always-available backup) — es + en
//
// Dual-language strategy: fetches in both the channel language
// AND English to maximize article pool. Articles carry their
// sourceLang so the content writer can translate as needed.
//
// Deduplicates by URL across all sources and languages.
// =============================================================

import { getLogger } from '../utils/logger.js';
import { fetchFromGNews } from './sources/gnews.js';
import { fetchFromNewsData } from './sources/newsdata.js';
import { fetchFromGoogleRSS } from './sources/google-rss.js';
import type { NewsArticle, NewsCategoryOrAlias } from '../config/types.js';

const MIN_ARTICLES = 8;  // minimum articles before trying next source

function dedup(existing: NewsArticle[], incoming: NewsArticle[]): NewsArticle[] {
  const seenUrls = new Set(existing.map(a => a.url));
  const added: NewsArticle[] = [];
  for (const article of incoming) {
    if (!seenUrls.has(article.url)) {
      seenUrls.add(article.url);
      added.push(article);
    }
  }
  return added;
}

/**
 * Fetch trending news from multiple sources with fallback chain.
 * Fetches in both channel language and English for maximum coverage.
 */
export async function fetchTrendingNews(
  apiKey: string,
  categories: NewsCategoryOrAlias[],
  language: string,
  country?: string,
  maxPerCategory: number = 10,
  fromHoursAgo: number = 24,
  newsdataApiKey?: string,
): Promise<NewsArticle[]> {
  const log = getLogger();
  const results: NewsArticle[] = [];
  const langs = language === 'en' ? ['en'] : [language, 'en'];

  log.info(`Fetching news (langs: ${langs.join('+')}, last ${fromHoursAgo}h, min ${MIN_ARTICLES} articles)...`);

  // --- Source 1: GNews ---
  log.info(`[Source 1/3] GNews...`);
  for (let li = 0; li < langs.length; li++) {
    if (li > 0) await new Promise(r => setTimeout(r, 5000)); // pause between languages to avoid 429
    const lang = langs[li];
    const isNative = lang === language;
    const articles = await fetchFromGNews(apiKey, categories, lang, country, maxPerCategory, fromHoursAgo, isNative);
    const unique = dedup(results, articles);
    results.push(...unique);
    log.info(`  GNews/${lang}: +${unique.length} unique (${results.length} total)`);
  }

  // --- Source 2: NewsData.io (if configured and still below minimum) ---
  if (newsdataApiKey && results.length < MIN_ARTICLES) {
    log.info(`[Source 2/3] NewsData.io (${results.length} < ${MIN_ARTICLES} articles)...`);
    for (const lang of langs) {
      const articles = await fetchFromNewsData(newsdataApiKey, categories, lang, country, fromHoursAgo);
      const unique = dedup(results, articles);
      results.push(...unique);
      log.info(`  NewsData/${lang}: +${unique.length} unique (${results.length} total)`);
    }
  } else if (!newsdataApiKey) {
    log.debug('[Source 2/3] NewsData.io — skipped (no API key)');
  } else {
    log.info(`[Source 2/3] NewsData.io — skipped (${results.length} >= ${MIN_ARTICLES} articles)`);
  }

  // --- Source 3: Google News RSS (if still below minimum) ---
  if (results.length < MIN_ARTICLES) {
    log.info(`[Source 3/3] Google News RSS (${results.length} < ${MIN_ARTICLES} articles)...`);
    for (const lang of langs) {
      const articles = await fetchFromGoogleRSS(categories, lang, fromHoursAgo);
      const unique = dedup(results, articles);
      results.push(...unique);
      log.info(`  GoogleRSS/${lang}: +${unique.length} unique (${results.length} total)`);
    }
  } else {
    log.info(`[Source 3/3] Google News RSS — skipped (${results.length} >= ${MIN_ARTICLES} articles)`);
  }

  // Sort newest first
  results.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  log.info(`Total: ${results.length} unique articles from ${[...new Set(results.map(a => a.provider))].join(', ')}`);

  return results;
}
