// =============================================================
// tech-news-bot Pipeline
//
// Usage:
//   npm run pipeline -- --channel epicentro
//   npm run pipeline -- --channel epicentro --dry-run
//
// Flow per run:
//   1. Fetch trending news (per channel categories + language)
//   2. Filter already-posted articles (7-day dedup window)
//   3. Claude curates/ranks articles by impact & relevance
//   4. For top N articles:
//      a. Write caption in channel's language (Claude)
//      b. Resolve image (article image → Pexels → null)
//      c. Post to Facebook (photo post or link post)
//      d. Track posted URL
// =============================================================

import { createLogger } from './utils/logger.js';
import { loadBotConfig } from './config/load-config.js';
import { fetchTrendingNews } from './1-news/news-fetcher.js';
import { curateArticles } from './1-news/news-curator.js';
import { writeCaption } from './2-content/content-writer.js';
import { resolveImage } from './3-image/image-fetcher.js';
import { postToFacebook } from './4-post/facebook-poster.js';
import { filterUnposted, markAsPosted } from './5-tracking/tracker.js';
import type { GeneratedPost, PostResult } from './config/types.js';

function parseArgs(): { channel: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let channel = 'epicentro';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--channel' && args[i + 1]) channel = args[++i];
    if (args[i] === '--dry-run') dryRun = true;
  }

  return { channel, dryRun };
}

export async function runPipeline(channelName: string, dryRunOverride?: boolean): Promise<PostResult[]> {
  const config = loadBotConfig(channelName);
  const log = createLogger(config.logLevel, config.logFile);
  const dryRun = dryRunOverride ?? config.dryRun;

  log.info('='.repeat(60));
  log.info(`tech-news-bot — channel: ${config.pageDisplayName} (${channelName})`);
  log.info(`Language: ${config.language} | Country: ${config.country || 'any'}`);
  log.info(`Categories: ${config.newsCategories.join(', ')}`);
  log.info(`Topic focus: ${config.topicFocus}`);
  log.info(`Max posts per run: ${config.maxPostsPerRun}`);
  if (dryRun) log.info('DRY RUN — no actual Facebook posts will be made');
  log.info('='.repeat(60));

  const results: PostResult[] = [];

  // --- Stage 1: Fetch trending news ---
  log.info('\n[1/5] Fetching trending news...');
  const allArticles = await fetchTrendingNews(
    config.gnewsApiKey,
    config.newsCategories,
    config.language,
    config.country,
    10,
    24,
    config.newsdataApiKey,
  );
  log.info(`Fetched ${allArticles.length} total articles`);

  if (allArticles.length === 0) {
    log.info('No articles fetched. Done.');
    return results;
  }

  // --- Stage 2: Filter already-posted ---
  log.info('\n[2/5] Filtering already-posted articles...');
  const freshArticles = filterUnposted(allArticles);
  log.info(`${freshArticles.length} unposted articles after dedup`);

  if (freshArticles.length === 0) {
    log.info('All articles already posted. Done.');
    return results;
  }

  // --- Stage 3: Claude curates by impact ---
  log.info('\n[3/5] Claude curating articles by impact...');
  const curated = await curateArticles(freshArticles, config);
  const toPost = curated.slice(0, config.maxPostsPerRun);
  log.info(`Will post ${toPost.length} article(s) this run`);

  // --- Stages 4-5: For each article: write → image → post → track ---
  for (let i = 0; i < toPost.length; i++) {
    const article = toPost[i];
    log.info(`\n--- Article ${i + 1}/${toPost.length} ---`);
    log.info(`Title: "${article.title.slice(0, 70)}"`);
    if ('relevanceScore' in article) {
      log.info(`Score: ${article.relevanceScore}/10 — ${article.curatedReason}`);
    }

    // Stage 4: Write caption
    log.info('[4/5] Writing caption...');
    const caption = await writeCaption(article, config);

    // Stage 5: Resolve image + Post to Facebook
    log.info('[5/5] Resolving image & posting to Facebook...');
    const imageUrl = await resolveImage(article, config.pexelsApiKey);

    const generatedPost: GeneratedPost = {
      article,
      caption,
      imageUrl,
      hashtags: config.hashtags,
    };

    const result = await postToFacebook(
      generatedPost,
      config.facebookPageId,
      config.facebookAccessToken,
      dryRun
    );

    results.push(result);

    if (result.success) {
      markAsPosted({
        articleUrl: article.url,
        facebookPostId: result.facebookPostId,
        title: article.title,
        category: article.category,
        postedAt: result.postedAt,
      });
      log.info(`Posted: ${result.facebookPostId}`);
    } else {
      log.error(`Failed: ${result.error}`);
    }

    // Delay between posts
    if (i < toPost.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  const succeeded = results.filter(r => r.success).length;
  log.info(`\nPipeline complete: ${succeeded}/${results.length} posts succeeded`);

  return results;
}

// --- Run directly ---
const { channel, dryRun } = parseArgs();
runPipeline(channel, dryRun).catch(err => {
  console.error(`Pipeline error: ${err.message}`);
  process.exit(1);
});
