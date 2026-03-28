// =============================================================
// Image Fetcher
//
// Priority:
//   1. Article's own image URL (from GNews response)
//   2. Pexels search by article keywords (if no article image)
//   3. null (poster will fall back to link post without photo)
//
// Pexels API docs: https://www.pexels.com/api/documentation/
// =============================================================

import axios from 'axios';
import { getLogger } from '../utils/logger.js';
import type { NewsArticle } from '../config/types.js';

interface PexelsPhoto {
  id: number;
  src: {
    original: string;
    large: string;
    medium: string;
  };
}

interface PexelsSearchResponse {
  photos: PexelsPhoto[];
  total_results: number;
}

function extractKeywords(article: NewsArticle): string {
  // Pull 2-4 meaningful words from the title for Pexels search
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'has',
    'have', 'had', 'be', 'been', 'will', 'its', 'it', 'that', 'this',
    'de', 'la', 'el', 'en', 'que', 'se', 'con', 'los', 'las', 'un', 'una',
  ]);

  const words = article.title
    .toLowerCase()
    .replace(/[^a-záéíóúñ\s]/gi, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  return words.slice(0, 3).join(' ') || article.category;
}

async function searchPexels(query: string, apiKey: string): Promise<string | null> {
  const log = getLogger();
  try {
    const response = await axios.get<PexelsSearchResponse>('https://api.pexels.com/v1/search', {
      headers: { Authorization: apiKey },
      params: { query, per_page: 5, orientation: 'landscape' },
      timeout: 10000,
    });

    const photos = response.data.photos;
    if (!photos || photos.length === 0) return null;

    // Pick a random photo from the top 5 results for variety
    const photo = photos[Math.floor(Math.random() * photos.length)];
    return photo.src.large;
  } catch (err: any) {
    log.warn(`Pexels search failed for "${query}": ${err.message}`);
    return null;
  }
}

export async function resolveImage(
  article: NewsArticle,
  pexelsApiKey?: string
): Promise<string | null> {
  const log = getLogger();

  // 1. Use article's own image (best — it's actually from the news story)
  if (article.image) {
    log.debug(`Using article image: ${article.image}`);
    return article.image;
  }

  // 2. Fallback: Pexels search by article keywords
  if (pexelsApiKey) {
    const keywords = extractKeywords(article);
    log.info(`No article image — searching Pexels for: "${keywords}"`);
    const pexelsUrl = await searchPexels(keywords, pexelsApiKey);
    if (pexelsUrl) {
      log.debug(`Pexels image found: ${pexelsUrl}`);
      return pexelsUrl;
    }
  }

  // 3. No image available — poster will fall back to link post
  log.info(`No image found for: "${article.title.slice(0, 60)}"`);
  return null;
}
