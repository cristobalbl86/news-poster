// =============================================================
// Logging utility with file + console output
// =============================================================

import winston from 'winston';
import { resolve } from 'path';
import { mkdirSync } from 'fs';

let loggerInstance: winston.Logger | null = null;

export function createLogger(logLevel: string = 'info', logFile: string = './logs/bot.log'): winston.Logger {
  if (loggerInstance) return loggerInstance;

  const logDir = resolve(logFile, '..');
  mkdirSync(logDir, { recursive: true });

  loggerInstance = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      })
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level}: ${message}`;
          })
        ),
      }),
      new winston.transports.File({ filename: logFile }),
    ],
  });

  return loggerInstance;
}

export function getLogger(): winston.Logger {
  if (!loggerInstance) return createLogger();
  return loggerInstance;
}
