// =============================================================
// tech-news-bot Scheduler
//
// Loads all channel configs from channels/*.env
// Schedules each channel's pipeline using its POSTING_SCHEDULE cron
//
// Usage:
//   npm run scheduler
//
// PM2 (keeps running after terminal closes):
//   npx pm2 start node --name "news-bot-scheduler" \
//     --cwd "/path/to/tech-news-bot" \
//     -- "node_modules/tsx/dist/cli.mjs" "scheduler/local-scheduler.ts"
// =============================================================

import cron from 'node-cron';
import { spawnSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../src/utils/logger.js';
import { loadAllChannels, loadBotConfig } from '../src/config/load-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../');
const log = createLogger();

const PIPELINE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per run

function runPipeline(channelName: string): void {
  log.info(`[scheduler] Triggering pipeline for channel: ${channelName}`);

  const result = spawnSync(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', 'src/pipeline.ts', '--channel', channelName],
    {
      cwd: ROOT,
      env: process.env,
      timeout: PIPELINE_TIMEOUT_MS,
      stdio: 'inherit',
    }
  );

  if (result.error) {
    log.error(`[scheduler] Pipeline error for ${channelName}: ${result.error.message}`);
  } else if (result.status !== 0) {
    log.error(`[scheduler] Pipeline exited with code ${result.status} for ${channelName}`);
  } else {
    log.info(`[scheduler] Pipeline completed for ${channelName}`);
  }
}

function start(): void {
  const channels = loadAllChannels();

  if (channels.length === 0) {
    log.warn('No channel configs found in channels/. Create a channels/{name}.env file to get started.');
    log.warn('See channels/cerebros.env.example for reference.');
    return;
  }

  log.info(`Found ${channels.length} channel(s): ${channels.join(', ')}`);

  for (const channelName of channels) {
    try {
      const config = loadBotConfig(channelName);
      const schedule = config.postingSchedule;

      if (!cron.validate(schedule)) {
        log.error(`Invalid cron expression for ${channelName}: "${schedule}"`);
        continue;
      }

      log.info(`Scheduling ${channelName}: "${schedule}"`);

      cron.schedule(schedule, () => {
        runPipeline(channelName);
      });

      log.info(`  → ${channelName} scheduled (next run at next cron tick)`);
    } catch (err: any) {
      log.error(`Failed to schedule ${channelName}: ${err.message}`);
    }
  }

  log.info('Scheduler running. Press Ctrl+C to stop.');
}

start();
