// =============================================================
// tech-news-bot — Type definitions
// =============================================================

// GNews supports these categories
export type NewsCategory = 'technology' | 'world' | 'science' | 'business' | 'entertainment' | 'health' | 'sports' | 'nation';

// Special pseudo-categories (resolved by news-fetcher into GNews calls)
export type NewsCategoryOrAlias = NewsCategory | 'mexico' | 'latam' | string;

export interface BotConfig {
  // Channel identity
  pageName: string;
  pageDisplayName: string;
  language: string;            // e.g. "es", "en", "fr", "pt"
  country?: string;            // e.g. "mx", "us", "ar" — filters GNews to that country's sources
  topicFocus: string;          // e.g. "tech news and AI", "sports", "politics" — guides Claude curation

  // Facebook (only platform)
  facebookPageId: string;
  facebookAccessToken: string;

  // Scheduling
  postingSchedule: string;
  maxPostsPerRun: number;

  // News
  newsCategories: NewsCategoryOrAlias[];
  hashtags: string;

  // Telegram approval (optional — approve/reject posts before publishing)
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramApprovalTimeout: number;  // ms to wait for approval before skipping

  // Shared
  gnewsApiKey: string;
  newsdataApiKey?: string;
  pexelsApiKey?: string;
  claudeCodePath: string;
  claudeCodeTimeout: number;
  logLevel: string;
  logFile: string;
  dryRun: boolean;
}

export type NewsProvider = 'gnews' | 'newsdata' | 'google-rss';

export interface NewsArticle {
  title: string;
  description: string;
  content: string;
  url: string;
  image: string | null;
  publishedAt: string;
  source: {
    name: string;
    url: string;
  };
  category: string;
  sourceLang: string;     // language the article was fetched in (e.g. "es", "en")
  provider: NewsProvider;  // which API provided this article
}

export interface CuratedArticle extends NewsArticle {
  relevanceScore: number;      // 1-10 score from Claude curation
  curatedReason: string;       // Why this article is relevant/impactful
}

export interface GeneratedPost {
  article: NewsArticle;
  caption: string;
  imageUrl: string | null;
  hashtags: string;
}

export interface PostResult {
  article: NewsArticle;
  facebookPostId: string;
  postedAt: string;
  success: boolean;
  error?: string;
}

export interface TrackedPost {
  articleUrl: string;
  facebookPostId: string;
  title: string;
  category: string;
  postedAt: string;
}
