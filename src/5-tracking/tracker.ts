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
const REJECTED_FILE = resolve(ROOT, 'output/rejected-articles.json');
const MAX_AGE_DAYS = 7;
const REJECTED_MAX_AGE_DAYS = 30;
const MAX_ENTRIES = 1000;

interface RejectedPost {
  articleUrl: string;
  title: string;
  rejectedAt: string;
  reason: string;
}

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

function loadRejected(): RejectedPost[] {
  try {
    const content = readFileSync(REJECTED_FILE, 'utf-8');
    return JSON.parse(content) as RejectedPost[];
  } catch {
    return [];
  }
}

function saveRejected(posts: RejectedPost[]): void {
  mkdirSync(dirname(REJECTED_FILE), { recursive: true });
  writeFileSync(REJECTED_FILE, JSON.stringify(posts, null, 2), 'utf-8');
}

function pruneOldRejected(posts: RejectedPost[]): RejectedPost[] {
  const cutoff = Date.now() - REJECTED_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return posts.filter(p => new Date(p.rejectedAt).getTime() > cutoff).slice(-MAX_ENTRIES);
}

export function filterUnposted<T extends { url: string }>(articles: T[]): T[] {
  const tracked = loadTracked();
  const rejected = loadRejected();
  const postedUrls = new Set(tracked.map(p => p.articleUrl));
  const rejectedUrls = new Set(rejected.map(p => p.articleUrl));
  return articles.filter(a => !postedUrls.has(a.url) && !rejectedUrls.has(a.url));
}

export function markAsRejected(post: { articleUrl: string; title: string; reason: string }): void {
  const log = getLogger();
  const rejected = pruneOldRejected(loadRejected());
  rejected.push({
    articleUrl: post.articleUrl,
    title: post.title,
    rejectedAt: new Date().toISOString(),
    reason: post.reason,
  });
  saveRejected(rejected);
  log.debug(`Tracked rejected: ${post.articleUrl}`);
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
