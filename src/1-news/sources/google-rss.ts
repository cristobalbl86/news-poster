// =============================================================
// Google News RSS source — no API key, unlimited
// Parses RSS XML feeds by topic
// =============================================================

import axios from 'axios';
import { getLogger } from '../../utils/logger.js';
import type { NewsArticle } from '../../config/types.js';

// Google News topic IDs
const TOPIC_MAP: Record<string, string> = {
  world: 'WORLD',
  technology: 'TECHNOLOGY',
  business: 'BUSINESS',
  science: 'SCIENCE_AND_TECHNOLOGY',
  health: 'HEALTH',
  entertainment: 'ENTERTAINMENT',
  sports: 'SPORTS',
  nation: 'NATION',
  general: 'TOP_STORIES',
};

// Google News locale params
const LOCALE_MAP: Record<string, { hl: string; gl: string; ceid: string }> = {
  es: { hl: 'es-419', gl: 'MX', ceid: 'MX:es-419' },
  en: { hl: 'en-US', gl: 'US', ceid: 'US:en' },
  pt: { hl: 'pt-BR', gl: 'BR', ceid: 'BR:pt-419' },
};

function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string; source: string }> {
  const items: Array<{ title: string; link: string; pubDate: string; source: string }> = [];

  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1];

    const title = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]
      || itemXml.match(/<title>(.*?)<\/title>/)?.[1]
      || '';
    const link = itemXml.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const pubDate = itemXml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const source = itemXml.match(/<source[^>]*>(.*?)<\/source>/)?.[1]
      || itemXml.match(/<source[^>]*url="([^"]*)">/)?.[1]
      || 'Google News';

    if (title && link) {
      items.push({ title: decodeHtmlEntities(title), link, pubDate, source });
    }
  }

  return items;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function toNewsArticle(item: { title: string; link: string; pubDate: string; source: string }, category: string, lang: string): NewsArticle {
  return {
    title: item.title,
    description: '',
    content: '',
    url: item.link,
    image: null,
    publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
    source: { name: item.source, url: '' },
    category,
    sourceLang: lang,
    provider: 'google-rss',
  };
}

export async function fetchFromGoogleRSS(
  categories: string[],
  lang: string,
  fromHoursAgo: number = 24,
): Promise<NewsArticle[]> {
  const log = getLogger();
  const locale = LOCALE_MAP[lang] || LOCALE_MAP['en'];
  const results: NewsArticle[] = [];
  const cutoff = Date.now() - fromHoursAgo * 60 * 60 * 1000;

  // Resolve categories to Google News topics
  const topics = [...new Set(
    categories
      .map(c => TOPIC_MAP[c.toLowerCase().trim()])
      .filter(Boolean)
  )];

  if (topics.length === 0) topics.push('TOP_STORIES');

  for (const topic of topics) {
    try {
      if (results.length > 0) await new Promise(r => setTimeout(r, 200));

      const url = `https://news.google.com/rss/topics/${topic}?hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
      const response = await axios.get<string>(url, {
        timeout: 10000,
        responseType: 'text',
      });

      const items = parseRssItems(response.data);

      // Filter by time
      const recent = items.filter(item => {
        if (!item.pubDate) return true;
        return new Date(item.pubDate).getTime() > cutoff;
      });

      const articles = recent.slice(0, 10).map(item => {
        const cat = Object.entries(TOPIC_MAP).find(([, v]) => v === topic)?.[0] || 'general';
        return toNewsArticle(item, cat, lang);
      });

      log.info(`  [google-rss/${lang}] ${articles.length} articles from "${topic}"`);
      results.push(...articles);
    } catch (err: any) {
      log.error(`  [google-rss/${lang}] Failed "${topic}": ${err.message}`);
    }
  }

  return results;
}
