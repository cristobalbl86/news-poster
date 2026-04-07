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

export type ApprovalOutcome = 'approved' | 'rejected' | 'timeout' | 'send_failed';

/**
 * Send a post preview to Telegram and wait for approve/reject.
 * Returns 'approved', 'rejected', 'timeout', or 'send_failed'.
 */
export async function requestApproval(
  post: GeneratedPost,
  index: number,
  total: number,
  token: string,
  chatId: string,
  timeoutMs: number = APPROVAL_TIMEOUT_MS
): Promise<ApprovalOutcome> {
  const log = getLogger();
  const callbackId = `post_${Date.now()}_${index}`;
  const previewText = buildPreviewText(post, index, total);
  const replyMarkup = buildInlineKeyboard(callbackId);

  // Send post preview. When an image is available, send the photo first
  // (with a short caption to stay under Telegram's 1024-char limit), then
  // always follow up with a sendMessage containing the full preview + keyboard.
  // The text message is the authoritative sentMessage for callback polling.
  let sentMessage: TelegramResponse;

  try {
    if (post.imageUrl) {
      // Send photo with a minimal caption — the full preview comes next
      const photoResult = await callTelegram(token, 'sendPhoto', {
        chat_id: chatId,
        photo: post.imageUrl,
        caption: `Post ${index}/${total} — Approval Required`,
      });
      if (!photoResult.ok) {
        log.warn(`sendPhoto failed: ${photoResult.description} — image will be omitted`);
      }
    }

    // Always send the full text preview with the inline keyboard
    sentMessage = await callTelegram(token, 'sendMessage', {
      chat_id: chatId,
      text: previewText,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
      disable_web_page_preview: false,
    });
  } catch (err: any) {
    log.error(`Failed to send Telegram approval message: ${err?.message ?? String(err)}`);
    return 'send_failed';
  }

  if (!sentMessage.ok) {
    log.error(`Failed to send Telegram approval message: ${sentMessage.description}`);
    return 'send_failed';
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
        // Iterate the FULL batch first, advancing lastUpdateId on every update,
        // so that all updates are confirmed before we act on a decision.
        // This prevents re-delivery of unconfirmed updates on subsequent polls.
        let decisionAction: string | null = null;
        let decisionCb: any = null;

        for (const update of updates.result) {
          lastUpdateId = update.update_id;

          if (decisionAction !== null) continue; // already found — just advance offset

          const cb = update.callback_query;
          if (!cb?.data) continue;

          // Validate the callback came from the expected chat and message
          const callbackChatId = cb.message?.chat?.id != null ? String(cb.message.chat.id) : undefined;
          const callbackMessageId = cb.message?.message_id;
          if (callbackChatId !== String(chatId)) continue;
          if (callbackMessageId !== sentMessage.result?.message_id) continue;

          const [action, id] = cb.data.split(':');
          if (id !== callbackId) continue;

          decisionAction = action;
          decisionCb = cb;
        }

        if (decisionAction !== null && decisionCb !== null) {
          // Answer the callback to remove the loading spinner
          await callTelegram(token, 'answerCallbackQuery', {
            callback_query_id: decisionCb.id,
            text: decisionAction === 'approve' ? 'Post approved!' : 'Post rejected.',
          });

          // Update the message to reflect the decision and remove the keyboard
          const statusText = decisionAction === 'approve'
            ? '\n\n<b>Status: APPROVED</b>'
            : '\n\n<b>Status: REJECTED</b>';

          await callTelegram(token, 'editMessageText', {
            chat_id: chatId,
            message_id: sentMessage.result.message_id,
            text: previewText + statusText,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [] }, // remove buttons
          });

          const outcome: ApprovalOutcome = decisionAction === 'approve' ? 'approved' : 'rejected';
          log.info(`Post ${index}/${total}: ${outcome.toUpperCase()} via Telegram`);
          return outcome;
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

  // Timeout — update message, remove keyboard, and reject
  log.warn(`Post ${index}/${total}: approval timed out after ${timeoutMs / 60000}min — skipping`);

  await callTelegram(token, 'editMessageText', {
    chat_id: chatId,
    message_id: sentMessage.result?.message_id,
    text: previewText + '\n\n<b>Status: TIMED OUT (skipped)</b>',
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [] }, // remove buttons
  }).catch(() => {});

  return 'timeout';
}

/**
 * Check if Telegram approval is configured.
 */
export function isTelegramApprovalEnabled(token?: string, chatId?: string): boolean {
  return Boolean(token && chatId);
}
