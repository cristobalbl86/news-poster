// =============================================================
// Claude Code CLI wrapper
// Uses `claude --print` to get responses without interactive mode
// =============================================================

import { spawnSync } from 'child_process';
import { getLogger } from './logger.js';

interface ClaudeCodeOptions {
  claudePath?: string;
  timeoutMs?: number;
}

export function askClaude(prompt: string, options: ClaudeCodeOptions = {}): string {
  const log = getLogger();
  const claudePath = options.claudePath || process.env.CLAUDE_CODE_PATH || 'claude';
  const timeoutMs = options.timeoutMs || parseInt(process.env.CLAUDE_CODE_TIMEOUT || '60000', 10);

  log.debug(`Calling Claude Code CLI (timeout: ${timeoutMs}ms)`);

  const result = spawnSync(claudePath, ['--print'], {
    input: prompt,
    encoding: 'utf-8',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: undefined },
    shell: true,
  });

  if (result.error) {
    if ((result.error as any).code === 'ETIMEDOUT') {
      throw new Error(`Claude Code CLI timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Claude Code CLI error: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || '';
    throw new Error(`Claude Code CLI error: ${stderr || `exited with code ${result.status}`}`);
  }

  return (result.stdout as string).trim();
}

export function askClaudeJson<T>(prompt: string, options: ClaudeCodeOptions = {}): T {
  const log = getLogger();

  const jsonPrompt = `${prompt}

CRITICAL: Respond with ONLY valid JSON. No markdown, no code fences, no explanation. Just the raw JSON object.`;

  const response = askClaude(jsonPrompt, options);

  let cleaned = response;
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) cleaned = jsonMatch[1].trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  } else if (firstBracket !== -1 && lastBracket !== -1) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    log.error(`Failed to parse Claude response as JSON. Raw: ${response.slice(0, 500)}`);
    throw new Error('Claude returned invalid JSON.');
  }
}
