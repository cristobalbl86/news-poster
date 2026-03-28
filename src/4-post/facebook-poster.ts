// =============================================================
// Facebook Poster — Meta Graph API v21.0
//
// Post strategy:
//   - WITH image URL  → POST /page-id/photos  (photo post with caption)
//   - WITHOUT image   → POST /page-id/feed    (link post — FB auto-extracts og:image)
//
// Facebook API docs:
//   https://developers.facebook.com/docs/graph-api/reference/page/photos/
//   https://developers.facebook.com/docs/graph-api/reference/page/feed/
// =============================================================

import axios from 'axios';
import { getLogger } from '../utils/logger.js';
import type { GeneratedPost, PostResult } from '../config/types.js';

const FB_API = 'https://graph.facebook.com/v21.0';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [5000, 10000, 20000];

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function postPhoto(
  pageId: string,
  accessToken: string,
  imageUrl: string,
  caption: string
): Promise<string> {
  const response = await axios.post(
    `${FB_API}/${pageId}/photos`,
    {
      url: imageUrl,
      caption,
      access_token: accessToken,
    },
    { timeout: 30000 }
  );
  return response.data.post_id || response.data.id;
}

async function postLink(
  pageId: string,
  accessToken: string,
  message: string,
  articleUrl: string
): Promise<string> {
  const response = await axios.post(
    `${FB_API}/${pageId}/feed`,
    {
      message,
      link: articleUrl,
      access_token: accessToken,
    },
    { timeout: 30000 }
  );
  return response.data.id;
}

export async function postToFacebook(
  post: GeneratedPost,
  pageId: string,
  accessToken: string,
  dryRun: boolean = false
): Promise<PostResult> {
  const log = getLogger();
  const fullCaption = `${post.caption}\n\n${post.hashtags}`.trim();

  if (dryRun) {
    log.info(`[DRY RUN] Would post: "${post.caption.slice(0, 80)}..."`);
    log.info(`[DRY RUN] Image: ${post.imageUrl || 'none (link post)'}`);
    return {
      article: post.article,
      facebookPostId: 'dry-run',
      postedAt: new Date().toISOString(),
      success: true,
    };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] ?? 20000;
      log.info(`Retry ${attempt}/${MAX_RETRIES} in ${delay / 1000}s...`);
      await sleep(delay);
    }

    try {
      let postId: string;

      if (post.imageUrl) {
        log.info(`Posting photo to Facebook page ${pageId}...`);
        postId = await postPhoto(pageId, accessToken, post.imageUrl, fullCaption);
      } else {
        log.info(`Posting link to Facebook page ${pageId} (no image)...`);
        postId = await postLink(pageId, accessToken, fullCaption, post.article.url);
      }

      log.info(`Successfully posted. Post ID: ${postId}`);
      return {
        article: post.article,
        facebookPostId: postId,
        postedAt: new Date().toISOString(),
        success: true,
      };
    } catch (err: any) {
      lastError = err;
      const status = err.response?.status;

      // Don't retry client errors (auth, validation)
      if (status && status >= 400 && status < 500) {
        log.error(`Facebook API error ${status}: ${err.response?.data?.error?.message || err.message}`);
        break;
      }

      log.warn(`Facebook post failed (attempt ${attempt + 1}): ${err.message}`);
    }
  }

  return {
    article: post.article,
    facebookPostId: '',
    postedAt: new Date().toISOString(),
    success: false,
    error: lastError?.message || 'Unknown error',
  };
}
