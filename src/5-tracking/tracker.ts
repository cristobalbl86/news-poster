// =============================================================
// Post Tracker — prevents duplicate posts
//
// Persists posted article URLs in output/posted-articles.json
// Keeps a 7-day rolling window (avoids re-posting trending
// stories that stay in the headlines across multiple cycles)
// =============================================================

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getLogger } from '../utils/logger.js';
import type { TrackedPost } from '../config/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../');
const TRACKING_FILE = resolve(ROOT, 'output/posted-articles.json');
const MAX_AGE_DAYS = 7;
const MAX_ENTRIES = 1000;

function loadTracked(): TrackedPost[] {
  try {
    const content = readFileSync(TRACKING_FILE, 'utf-8');
    return JSON.parse(content) as TrackedPost[];
  } catch {
    return [];
  }
}

function saveTracked(posts: TrackedPost[]): void {
  mkdirSync(dirname(TRACKING_FILE), { recursive: true });
  writeFileSync(TRACKING_FILE, JSON.stringify(posts, null, 2), 'utf-8');
}

function pruneOld(posts: TrackedPost[]): TrackedPost[] {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const pruned = posts.filter(p => new Date(p.postedAt).getTime() > cutoff);
  // Also enforce max entries as a safety cap
  return pruned.slice(-MAX_ENTRIES);
}

export function isAlreadyPosted(articleUrl: string): boolean {
  const tracked = loadTracked();
  return tracked.some(p => p.articleUrl === articleUrl);
}

export function filterUnposted<T extends { url: string }>(articles: T[]): T[] {
  const tracked = loadTracked();
  const postedUrls = new Set(tracked.map(p => p.articleUrl));
  return articles.filter(a => !postedUrls.has(a.url));
}

export function markAsPosted(post: TrackedPost): void {
  const log = getLogger();
  const tracked = pruneOld(loadTracked());
  tracked.push(post);
  saveTracked(tracked);
  log.debug(`Tracked: ${post.articleUrl}`);
}

export function getRecentPosts(limitDays: number = 1): TrackedPost[] {
  const cutoff = Date.now() - limitDays * 24 * 60 * 60 * 1000;
  return loadTracked().filter(p => new Date(p.postedAt).getTime() > cutoff);
}
