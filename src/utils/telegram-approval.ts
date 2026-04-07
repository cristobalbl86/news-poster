// =============================================================
// Telegram Post Approval — Interactive approve/reject flow
//
// Sends each generated post to Telegram with inline keyboard
// buttons (Approve / Reject). Polls for the user's response
// and returns the decision.
//
// Requires: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env
// If not configured, all posts are auto-approved (no-op).
//
// Telegram Bot API docs:
//   https://core.telegram.org/bots/api#sendmessage
//   https://core.telegram.org/bots/api#sendphoto
//   https://core.telegram.org/bots/api#answercallbackquery
// =============================================================

import { getLogger } from './logger.js';
import type { GeneratedPost } from '../config/types.js';

const POLL_INTERVAL_MS = 3_000;
const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface TelegramResponse {
  ok: boolean;
  result?: any;
  description?: string;
}

function telegramUrl(token: string, method: string): string {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function callTelegram(
  token: string,
  method: string,
  body: Record<string, any>
): Promise<TelegramResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(telegramUrl(token, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await res.json()) as TelegramResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildPreviewText(post: GeneratedPost, index: number, total: number): string {
  const article = post.article;
  const lines: string[] = [];

  lines.push(`<b>Post ${index}/${total} — Approval Required</b>`);
  lines.push('');
  lines.push(`<b>Title:</b> ${escapeHtml(article.title)}`);
  if (article.description) {
    lines.push(`<b>Description:</b> ${escapeHtml(article.description)}`);
  }
  lines.push(`<b>Source:</b> ${escapeHtml(article.source.name)}`);
  lines.push(`<b>Category:</b> ${escapeHtml(article.category)}`);
  lines.push(`<b>Link:</b> ${escapeHtml(article.url)}`);
  lines.push('');
  lines.push('<b>Caption:</b>');
  lines.push(escapeHtml(post.caption));
  if (post.hashtags) {
    lines.push('');
    lines.push(escapeHtml(post.hashtags));
  }
  if (post.imageUrl) {
    lines.push('');
    lines.push(`<b>Image:</b> ${escapeHtml(post.imageUrl)}`);
  }

  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildInlineKeyboard(callbackId: string) {
  return {
    inline_keyboard: [
      [
        { text: 'Approve', callback_data: `approve:${callbackId}` },
        { text: 'Reject', callback_data: `reject:${callbackId}` },
      ],
    ],
  };
}

/**
 * Send a post preview to Telegram and wait for approve/reject.
 * Returns true if approved, false if rejected or timed out.
 */
export async function requestApproval(
  post: GeneratedPost,
  index: number,
  total: number,
  token: string,
  chatId: string,
  timeoutMs: number = APPROVAL_TIMEOUT_MS
): Promise<boolean> {
  const log = getLogger();
  const callbackId = `post_${Date.now()}_${index}`;
  const previewText = buildPreviewText(post, index, total);
  const replyMarkup = buildInlineKeyboard(callbackId);

  // Send post preview — use sendPhoto if image available, otherwise sendMessage
  let sentMessage: TelegramResponse;

  if (post.imageUrl) {
    sentMessage = await callTelegram(token, 'sendPhoto', {
      chat_id: chatId,
      photo: post.imageUrl,
      caption: previewText,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });

    // If sendPhoto fails (e.g. image URL not accessible), fall back to sendMessage
    if (!sentMessage.ok) {
      log.warn(`sendPhoto failed: ${sentMessage.description} — falling back to text`);
      sentMessage = await callTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text: previewText,
        parse_mode: 'HTML',
        reply_markup: replyMarkup,
        disable_web_page_preview: false,
      });
    }
  } else {
    sentMessage = await callTelegram(token, 'sendMessage', {
      chat_id: chatId,
      text: previewText,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
      disable_web_page_preview: false,
    });
  }

  if (!sentMessage.ok) {
    log.error(`Failed to send Telegram approval message: ${sentMessage.description}`);
    return false;
  }

  log.info(`Telegram approval sent for post ${index}/${total} — waiting for response...`);

  // Poll for callback query response
  const deadline = Date.now() + timeoutMs;
  let lastUpdateId = 0;

  while (Date.now() < deadline) {
    try {
      const updates = await callTelegram(token, 'getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 5,
        allowed_updates: ['callback_query'],
      });

      if (updates.ok && Array.isArray(updates.result)) {
        for (const update of updates.result) {
          lastUpdateId = update.update_id;

          const cb = update.callback_query;
          if (!cb?.data) continue;

          const [action, id] = cb.data.split(':');
          if (id !== callbackId) continue;

          // Answer the callback to remove the loading spinner
          await callTelegram(token, 'answerCallbackQuery', {
            callback_query_id: cb.id,
            text: action === 'approve' ? 'Post approved!' : 'Post rejected.',
          });

          // Update the message to reflect the decision
          const statusText = action === 'approve'
            ? '\n\n<b>Status: APPROVED</b>'
            : '\n\n<b>Status: REJECTED</b>';

          const editMethod = post.imageUrl && sentMessage.result?.photo
            ? 'editMessageCaption'
            : 'editMessageText';

          const editPayload: Record<string, any> = {
            chat_id: chatId,
            message_id: sentMessage.result.message_id,
            parse_mode: 'HTML',
          };

          if (editMethod === 'editMessageCaption') {
            editPayload.caption = previewText + statusText;
          } else {
            editPayload.text = previewText + statusText;
          }

          await callTelegram(token, editMethod, editPayload);

          const approved = action === 'approve';
          log.info(`Post ${index}/${total}: ${approved ? 'APPROVED' : 'REJECTED'} via Telegram`);
          return approved;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        log.debug('Telegram poll timed out — retrying...');
      } else {
        log.warn(`Telegram poll error (non-fatal): ${err?.message ?? String(err)}`);
      }
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }

  // Timeout — update message and reject
  log.warn(`Post ${index}/${total}: approval timed out after ${timeoutMs / 60000}min — skipping`);

  const timeoutEditMethod = post.imageUrl && sentMessage.result?.photo
    ? 'editMessageCaption'
    : 'editMessageText';

  const timeoutPayload: Record<string, any> = {
    chat_id: chatId,
    message_id: sentMessage.result?.message_id,
    parse_mode: 'HTML',
  };

  const timeoutStatus = '\n\n<b>Status: TIMED OUT (skipped)</b>';
  if (timeoutEditMethod === 'editMessageCaption') {
    timeoutPayload.caption = previewText + timeoutStatus;
  } else {
    timeoutPayload.text = previewText + timeoutStatus;
  }

  await callTelegram(token, timeoutEditMethod, timeoutPayload).catch(() => {});

  return false;
}

/**
 * Check if Telegram approval is configured.
 */
export function isTelegramApprovalEnabled(token?: string, chatId?: string): boolean {
  return Boolean(token && chatId);
}
