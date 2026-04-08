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
  topicCluster?: string;
}

function buildCurationPrompt(articles: NewsArticle[], config: BotConfig): string {
  const now = new Date();
  const articleList = articles.map((a, i) => {
    const ageMs = now.getTime() - new Date(a.publishedAt).getTime();
    const ageMin = Math.round(ageMs / 60000);
    const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
    const langTag = a.sourceLang && a.sourceLang !== config.language ? ` [${a.sourceLang.toUpperCase()}]` : '';
    return `[${i}] "${a.title}" — ${a.description || 'No description'} (source: ${a.source.name}, category: ${a.category}, published: ${ageLabel})${langTag}`;
  }).join('\n');

  return `You are a social media editor for a Facebook page called "${config.pageDisplayName}".
The page's focus is: ${config.topicFocus}
The audience language is: ${config.language}

CRITICAL: This page competes on SPEED. Being first to post breaking news is the #1 priority.

NOTE: Some articles are in English (marked [EN]). Score them equally — they will be translated before posting. Do NOT penalize articles for being in a different language.

Below are ${articles.length} news articles fetched from trending headlines. Your job is to rank them by a combination of RECENCY and GLOBAL IMPACT. Scoring rules:
1. **Recency is king** — articles published in the last 1-2 hours should get a +2 bonus. Articles older than 4 hours should be penalized.
2. **Breaking news** — developing stories, "just in" events, or first reports should score highest.
3. **GLOBAL impact only** — the story must matter to a worldwide audience or to Mexico/Latin America specifically. Examples of GLOBAL impact: wars, major geopolitical events, US/China/EU/Russia news, big tech (Google, OpenAI, Apple, Meta, Tesla, SpaceX), AI breakthroughs, global markets/economy, climate disasters, major scientific discoveries, world-famous figures.
4. **STRICTLY SKIP regional/local stories** from countries that aren't globally influential — score them 1-3. This includes hyper-local news from Uganda, Ireland, India (unless the story has worldwide implications), Philippines, Nigeria, Kenya, Pakistan, Bangladesh, regional politics in small countries, local sports, local crime, local elections, etc. A story is only relevant if it would be covered by major international outlets like Reuters, BBC, AP, AFP.
5. **Mexico/US/Latam exception** — Mexico-specific stories ARE relevant (this is a Mexican audience). Latin America/US stories with significance are also relevant.
6. **Topic focus match** — prioritize stories matching the page focus: ${config.topicFocus}
7. **Skip** — stories that are too niche, too local, too old, clickbait, duplicates, or pure entertainment gossip.

Articles:
${articleList}

**DEDUPLICATION RULE**: If multiple articles cover the same event or story (e.g., several articles about the same war, the same product launch, the same person), include ONLY the single best one. Do not return near-duplicates — variety across different topics is required.

Return a JSON array of objects, one per article, with:
- "index": the article number [0..${articles.length - 1}]
- "score": score from 1 (skip) to 10 (must post NOW) — weight recency heavily
- "reason": one sentence explaining why (in ${config.language})
- "topicCluster": a short label for the story topic (e.g., "Iran war", "Apple earnings", "OpenAI GPT-5") — used to prevent duplicate posts

Sort the array by score descending (highest first). Only include articles with score >= 5. Never include two articles with the same topicCluster.`;
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
    const seenClusters = new Set<string>();
    for (const r of results) {
      if (r.index >= 0 && r.index < articles.length && r.score >= 5) {
        // Client-side dedup: skip if same topic cluster already included
        const cluster = r.topicCluster?.toLowerCase().trim();
        if (cluster && seenClusters.has(cluster)) {
          log.info(`  Skipping duplicate topic cluster "${r.topicCluster}"`);
          continue;
        }
        if (cluster) seenClusters.add(cluster);
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
