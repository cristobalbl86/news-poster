// =============================================================
// News Curator — Claude AI ranks articles by impact
//
// Why not just use newest-first? Because:
//   - News APIs return whatever's trending, but not all stories
//     are equally impactful or engaging for Facebook.
//   - Claude evaluates each article for virality, relevance to
//     the channel's topic focus, and audience impact.
//   - This gives much better post quality than blind date sorting.
//
// This is why we use GNews + Claude together:
//   GNews → reliable structured data, images, real-time
//   Claude → intelligent curation, engagement ranking
// =============================================================

import { askClaudeJson } from '../utils/claude-code-cli.js';
import { getLogger } from '../utils/logger.js';
import type { NewsArticle, CuratedArticle, BotConfig } from '../config/types.js';

interface CurationResult {
  index: number;
  score: number;
  reason: string;
}

function buildCurationPrompt(articles: NewsArticle[], config: BotConfig): string {
  const now = new Date();
  const articleList = articles.map((a, i) => {
    const ageMs = now.getTime() - new Date(a.publishedAt).getTime();
    const ageMin = Math.round(ageMs / 60000);
    const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
    return `[${i}] "${a.title}" — ${a.description || 'No description'} (source: ${a.source.name}, category: ${a.category}, published: ${ageLabel})`;
  }).join('\n');

  return `You are a social media editor for a Facebook page called "${config.pageDisplayName}".
The page's focus is: ${config.topicFocus}
The audience language is: ${config.language}

CRITICAL: This page competes on SPEED. Being first to post breaking news is the #1 priority.

Below are ${articles.length} news articles fetched from trending headlines. Your job is to rank them by a combination of RECENCY and IMPACT. Scoring rules:
1. **Recency is king** — articles published in the last 1-2 hours should get a +2 bonus. Articles older than 4 hours should be penalized.
2. **Breaking news** — developing stories, "just in" events, or first reports should score highest.
3. **Impact & engagement** — how impactful, surprising, or emotionally compelling is the story for the audience?
4. **Relevance** — how well does it match the page's topic focus?
5. **Skip** — stories that are too niche, too old, clickbait with no substance, or duplicates of the same event.

Articles:
${articleList}

Return a JSON array of objects, one per article, with:
- "index": the article number [0..${articles.length - 1}]
- "score": score from 1 (skip) to 10 (must post NOW) — weight recency heavily
- "reason": one sentence explaining why (in ${config.language})

Sort the array by score descending (highest first). Only include articles with score >= 5.`;
}

export async function curateArticles(
  articles: NewsArticle[],
  config: BotConfig
): Promise<CuratedArticle[]> {
  const log = getLogger();

  if (articles.length === 0) return [];

  // If only 1-2 articles, skip curation overhead
  if (articles.length <= 2) {
    log.info('Only 1-2 articles — skipping AI curation');
    return articles.map(a => ({ ...a, relevanceScore: 7, curatedReason: 'Auto-selected (few articles)' }));
  }

  log.info(`Curating ${articles.length} articles with Claude...`);

  try {
    const prompt = buildCurationPrompt(articles, config);
    const results = askClaudeJson<CurationResult[]>(prompt, {
      claudePath: config.claudeCodePath,
      timeoutMs: config.claudeCodeTimeout,
    });

    const curated: CuratedArticle[] = [];
    for (const r of results) {
      if (r.index >= 0 && r.index < articles.length && r.score >= 5) {
        curated.push({
          ...articles[r.index],
          relevanceScore: r.score,
          curatedReason: r.reason,
        });
      }
    }

    // Sort by score descending
    curated.sort((a, b) => b.relevanceScore - a.relevanceScore);

    log.info(`Curation result: ${curated.length}/${articles.length} articles scored >= 5`);
    for (const c of curated.slice(0, 5)) {
      log.info(`  [${c.relevanceScore}/10] ${c.title.slice(0, 60)}`);
    }

    return curated;
  } catch (err: any) {
    log.error(`Curation failed: ${err.message} — falling back to newest-first`);
    // Fallback: return all articles with neutral score
    return articles.map(a => ({ ...a, relevanceScore: 5, curatedReason: 'Curation failed — default' }));
  }
}
