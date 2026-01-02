import type { LogLevel } from "./validation.js";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

// Store original console methods
const originalConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  log: console.log.bind(console),
};

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatPrefix(level: LogLevel): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}]`;
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

// Override console methods
console.debug = (...args: unknown[]) => {
  if (shouldLog("debug")) {
    originalConsole.debug(formatPrefix("debug"), ...args);
  }
};

console.info = (...args: unknown[]) => {
  if (shouldLog("info")) {
    originalConsole.info(formatPrefix("info"), ...args);
  }
};

console.warn = (...args: unknown[]) => {
  if (shouldLog("warn")) {
    originalConsole.warn(formatPrefix("warn"), ...args);
  }
};

console.error = (...args: unknown[]) => {
  if (shouldLog("error")) {
    originalConsole.error(formatPrefix("error"), ...args);
  }
};

// Also override console.log to use info level
console.log = (...args: unknown[]) => {
  if (shouldLog("info")) {
    originalConsole.log(formatPrefix("info"), ...args);
  }
};
