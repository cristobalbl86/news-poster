// =============================================================
// Content Writer — Claude generates Facebook captions
//
// Language-aware: uses channel's configured language.
// Style: short, punchy, breaking-news tone (like epicentro page)
// Format: 2-4 sentences, no hashtags (added separately)
// =============================================================

import { askClaude } from '../utils/claude-code-cli.js';
import { translateArticle } from '../utils/translator.js';
import { getLogger } from '../utils/logger.js';
import type { NewsArticle, BotConfig } from '../config/types.js';

// Language-specific prompt templates
const LANGUAGE_PROMPTS: Record<string, { role: string; instructions: string; closingInstruction: string }> = {
  es: {
    role: 'Eres el editor de una página de Facebook que publica noticias impactantes.',
    instructions: `Escribe una publicación de Facebook en ESPAÑOL. Requisitos:
- 2 a 4 oraciones cortas y directas
- Comienza de manera impactante (puedes usar frases como "De último momento:", "Atención:", o simplemente entrar directo al hecho)
- Incluye los datos más importantes y sorprendentes
- Tono informativo pero con gancho emocional
- NO uses hashtags (se agregarán por separado)
- NO uses emojis
- Máximo 280 caracteres total`,
    closingInstruction: 'Responde SOLO con el texto de la publicación, sin comillas ni explicación adicional.',
  },
  en: {
    role: 'You are the editor of a Facebook page that publishes impactful news.',
    instructions: `Write a Facebook post in ENGLISH. Requirements:
- 2 to 4 short, direct sentences
- Start with impact (e.g. "Breaking:", "Just in:", or go straight to the fact)
- Include the most important and surprising data
- Informative tone with emotional hook
- NO hashtags (added separately)
- NO emojis
- Maximum 280 characters total`,
    closingInstruction: 'Respond ONLY with the post text, no quotes or extra explanation.',
  },
  pt: {
    role: 'Você é o editor de uma página do Facebook que publica notícias impactantes.',
    instructions: `Escreva uma publicação no Facebook em PORTUGUÊS. Requisitos:
- 2 a 4 frases curtas e diretas
- Comece de forma impactante (ex: "Urgente:", "Atenção:", ou vá direto ao fato)
- Inclua os dados mais importantes e surpreendentes
- Tom informativo com gancho emocional
- NÃO use hashtags (serão adicionadas separadamente)
- NÃO use emojis
- Máximo 280 caracteres no total`,
    closingInstruction: 'Responda APENAS com o texto da publicação, sem aspas ou explicação adicional.',
  },
};

function getLanguagePrompt(lang: string) {
  return LANGUAGE_PROMPTS[lang] || LANGUAGE_PROMPTS['en'];
}

function buildPrompt(title: string, description: string, article: NewsArticle, config: BotConfig): string {
  const lp = getLanguagePrompt(config.language);

  return `${lp.role}

Page name: "${config.pageDisplayName}"
Page focus: ${config.topicFocus}

${lp.instructions}

News article:
Title: ${title}
Description: ${description}
Source: ${article.source.name}
Category: ${article.category}

${lp.closingInstruction}`;
}

export async function writeCaption(
  article: NewsArticle,
  config: BotConfig
): Promise<string> {
  const log = getLogger();
  const needsTranslation = article.sourceLang && article.sourceLang !== config.language;
  log.info(`Writing caption (lang=${config.language}${needsTranslation ? `, translating from ${article.sourceLang}` : ''}) for: "${article.title.slice(0, 60)}..."`);

  try {
    let title = article.title;
    let description = article.description;

    if (needsTranslation) {
      const translated = await translateArticle(
        article.title,
        article.description,
        article.sourceLang,
        config.language
      );
      title = translated.translatedTitle;
      description = translated.translatedDescription;
      log.info(`Translated title: "${title.slice(0, 60)}..."`);
    }

    const caption = askClaude(buildPrompt(title, description, article, config), {
      claudePath: config.claudeCodePath,
      timeoutMs: config.claudeCodeTimeout,
    });
    return caption.replace(/^["'"]|["'"]$/g, '').trim();
  } catch (err: any) {
    log.error(`Failed to write caption: ${err.message}`);
    const fallback = `${article.title}. ${article.description || ''}`.slice(0, 280).trim();
    log.info(`Using fallback caption: "${fallback.slice(0, 60)}..."`);
    return fallback;
  }
}
