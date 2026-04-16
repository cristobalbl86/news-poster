import translate from 'google-translate-api-x';
import { getLogger } from './logger.js';

interface TranslateResult {
  translatedTitle: string;
  translatedDescription: string;
}

export async function translateArticle(
  title: string,
  description: string,
  fromLang: string,
  toLang: string
): Promise<TranslateResult> {
  const log = getLogger();

  if (fromLang === toLang) {
    return { translatedTitle: title, translatedDescription: description };
  }

  log.info(`Translating article from ${fromLang} to ${toLang}...`);

  try {
    const texts = [title, description || ''].filter(t => t.length > 0);
    const results = await translate(texts, { from: fromLang, to: toLang });

    const translated = Array.isArray(results) ? results : [results];

    return {
      translatedTitle: translated[0]?.text || title,
      translatedDescription: texts.length > 1 ? (translated[1]?.text || description) : description,
    };
  } catch (err: any) {
    log.warn(`Translation failed (${err.message}), using original text`);
    return { translatedTitle: title, translatedDescription: description };
  }
}
