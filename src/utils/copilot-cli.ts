// =============================================================
// GitHub Copilot API client
// Uses the GitHub Models API (OpenAI-compatible) for AI tasks.
// Auth: GITHUB_TOKEN env var (standard GitHub PAT or OAuth token)
// =============================================================

import axios from 'axios';
import { getLogger } from './logger.js';

const GITHUB_MODELS_ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 60_000;

interface CopilotOptions {
  model?: string;
  timeoutMs?: number;
}

export async function askCopilot(prompt: string, options: CopilotOptions = {}): Promise<string> {
  const log = getLogger();
  const model = options.model || process.env.COPILOT_MODEL || DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs || parseInt(process.env.COPILOT_TIMEOUT || String(DEFAULT_TIMEOUT_MS), 10);
  const githubToken = process.env.GITHUB_TOKEN;

  if (!githubToken) throw new Error('GITHUB_TOKEN is required for Copilot API calls');

  log.debug(`Calling GitHub Copilot API (model: ${model}, timeout: ${timeoutMs}ms)`);

  try {
    const response = await axios.post(
      GITHUB_MODELS_ENDPOINT,
      {
        model,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
      }
    );

    return (response.data.choices[0].message.content as string).trim();
  } catch (err: any) {
    if (err.code === 'ECONNABORTED') {
      throw new Error(`GitHub Copilot API timed out after ${timeoutMs}ms`);
    }
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`GitHub Copilot API error: ${detail}`);
  }
}

export async function askCopilotJson<T>(prompt: string, options: CopilotOptions = {}): Promise<T> {
  const log = getLogger();

  const jsonPrompt = `${prompt}

CRITICAL: Respond with ONLY valid JSON. No markdown, no code fences, no explanation. Just the raw JSON object.`;

  const response = await askCopilot(jsonPrompt, options);

  let cleaned = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) cleaned = jsonMatch[1].trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  const braceValid = firstBrace !== -1 && lastBrace !== -1;
  const bracketValid = firstBracket !== -1 && lastBracket !== -1;

  if (bracketValid && (!braceValid || firstBracket < firstBrace)) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  } else if (braceValid) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    log.error(`Failed to parse Copilot response as JSON. Raw: ${response.slice(0, 500)}`);
    throw new Error('GitHub Copilot returned invalid JSON.');
  }
}
