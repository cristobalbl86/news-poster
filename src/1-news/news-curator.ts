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

// Hard cap on articles sent to Claude — keeps prompt small and prevents timeouts.
// Pre-selection ensures Mexico-category articles always have guaranteed slots.
const MAX_ARTICLES_FOR_CURATION = 35;

// Minimum timeout for curation regardless of channel config — curation is slow by design.
const MIN_CURATION_TIMEOUT_MS = 150_000; // 2.5 minutes

interface CurationResult {
  index: number;
  score: number;
  reason: string;
  topicCluster?: string;
}

/**
 * Pre-select articles before sending to Claude.
 * Guarantees Mexico-category articles get up to 1/3 of available slots,
 * then fills remaining slots with other articles by recency.
 */
function preselectArticles(articles: NewsArticle[], max: number): NewsArticle[] {
  if (articles.length <= max) return articles;

  // Articles are already sorted newest-first from the fetcher
  const mexicoArticles = articles.filter(a => a.category === 'mexico');
  const otherArticles  = articles.filter(a => a.category !== 'mexico');

  const mexicoSlots = Math.min(mexicoArticles.length, Math.ceil(max / 3));
  const otherSlots  = max - mexicoSlots;

  const selected = [
    ...mexicoArticles.slice(0, mexicoSlots),
    ...otherArticles.slice(0, otherSlots),
  ];

  // Re-sort by recency so Claude sees a coherent newest-first list
  selected.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  return selected;
}

function buildCurationPrompt(articles: NewsArticle[], config: BotConfig): string {
  const now = new Date();
  const articleList = articles.map((a, i) => {
    const ageMs = now.getTime() - new Date(a.publishedAt).getTime();
    const ageMin = Math.round(ageMs / 60000);
    const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin / 60)}h ago`;
    const langTag = a.sourceLang && a.sourceLang !== config.language ? ` [${a.sourceLang.toUpperCase()}]` : '';
    // Trim description to keep prompt compact
    const desc = (a.description || '').slice(0, 100) || 'No description';
    return `[${i}] "${a.title}" — ${desc} (${a.source.name}, ${a.category}, ${ageLabel})${langTag}`;
  }).join('\n');

  return `You are a social media editor for a Facebook page called "${config.pageDisplayName}".
The page's focus is: ${config.topicFocus}
The audience language is: ${config.language}

CRITICAL: This page competes on SPEED. Being first to post breaking news is the #1 priority.

NOTE: Some articles are in a different language (marked with tags like [EN]). Score them equally — they are automatically translated before posting. Do NOT penalize articles for being in a different language.

Below are ${articles.length} news articles fetched from trending headlines. Your job is to rank them by a combination of RECENCY and IMPACT. Scoring rules:
1. **Recency is king** — articles published in the last 1-2 hours should get a +2 bonus. Articles older than 4 hours should be penalized.
2. **Breaking news** — developing stories, "just in" events, or first reports should score highest.
3. **GLOBAL impact** — the story matters to a worldwide audience. Examples: wars, major geopolitical events, US/China/EU/Russia news, big tech (Google, OpenAI, Apple, Meta, Tesla, SpaceX), AI breakthroughs, global markets/economy, climate disasters, major scientific discoveries, world-famous figures.
3b. **MEXICO PRIORITY** — this page serves a Mexican audience. The following topics score 7–9 regardless of international significance:
    - Mexican domestic politics: Claudia Sheinbaum, gabinete, Congreso, elecciones, partidos políticos
    - Mexican economy: peso, inflación, BANXICO, PEMEX, PIB, desempleo, inversión extranjera, nearshoring
    - Security: cárteles, crimen organizado, Fuerzas Armadas, Guardia Nacional, violencia, desapariciones
    - Natural disasters or public emergencies in Mexico
    - Liga MX, Selección Mexicana, deportistas mexicanos destacados
    - International news with direct Mexico impact: aranceles de EE.UU. a México, política migratoria de Trump, deportaciones, remesas, relaciones diplomáticas México-EE.UU., precio del petróleo, inversión en México
4. **Skip truly irrelevant regional/local stories** — score 1-3 for hyper-local news from countries with no global influence and no connection to Mexico. This includes local crime, local elections, local sports from Uganda, Philippines, Bangladesh, Pakistan, etc. Mexico-domestic stories are NEVER "too local" for this page.
5. **Topic focus match** — prioritize stories matching the page focus: ${config.topicFocus}. EXCEPTION: For sports results (match results, standings, athlete news) and science/space milestones (missions, discoveries, launches), do NOT apply the age penalty from rule 1 — a Champions League result or a space mission update is still worth posting at 4-6 hours old.
6. **Skip** — stories that are too niche, too old, clickbait, pure celebrity gossip with no news value, or obvious duplicates.

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

  const toSend = preselectArticles(articles, MAX_ARTICLES_FOR_CURATION);
  log.info(`Curating ${toSend.length}/${articles.length} articles with Claude (pre-selected)...`);

  try {
    const prompt = buildCurationPrompt(toSend, config);
    const timeoutMs = Math.max(config.claudeCodeTimeout, MIN_CURATION_TIMEOUT_MS);
    const results = askClaudeJson<CurationResult[]>(prompt, {
      claudePath: config.claudeCodePath,
      timeoutMs,
    });

    const curated: CuratedArticle[] = [];
    const seenClusters = new Set<string>();
    for (const r of results) {
      if (r.index >= 0 && r.index < toSend.length && r.score >= 5) {
        // Client-side dedup: skip if same topic cluster already included
        const cluster = r.topicCluster?.toLowerCase().trim();
        if (cluster && seenClusters.has(cluster)) {
          log.info(`  Skipping duplicate topic cluster "${r.topicCluster}"`);
          continue;
        }
        if (cluster) seenClusters.add(cluster);
        curated.push({
          ...toSend[r.index],
          relevanceScore: r.score,
          curatedReason: r.reason,
        });
      }
    }

    // Sort by score descending
    curated.sort((a, b) => b.relevanceScore - a.relevanceScore);

    log.info(`Curation result: ${curated.length}/${toSend.length} articles scored >= 5`);
    for (const c of curated) {
      log.info(`  [${c.relevanceScore}/10][${c.category}] ${c.title.slice(0, 60)}`);
    }

    return curated;
  } catch (err: any) {
    log.error(`Curation failed: ${err.message} — falling back to newest-first`);
    // Fallback: return all articles with neutral score
    return articles.map(a => ({ ...a, relevanceScore: 5, curatedReason: 'Curation failed — default' }));
  }
}
