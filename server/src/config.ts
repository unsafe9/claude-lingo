import { existsSync, mkdirSync, readFileSync, writeFileSync, watch, type FSWatcher } from "fs";
import { homedir } from "os";
import { join } from "path";
import { ConfigSchema, KNOWN_CONFIG_KEYS, formatZodErrors, type Config } from "./validation.js";

export type { Config } from "./validation.js";

// Hardcoded port (not configurable)
export const SERVER_PORT = 41765;

const DEFAULT_CONFIG: Config = {
  language: "English",
  mode: "non-block",
  model: "haiku",
  claudeExecutablePath: "",
  queueBatchSize: 5,
  queueIntervalMs: 30000,
  logLevel: "info",
  tone: "balanced",
  autoCopyCorrections: false,
};

// Filter out unknown fields and log them
function filterUnknownFields(obj: Record<string, unknown>): Partial<Config> {
  const filtered: Record<string, unknown> = {};
  const unknownKeys: string[] = [];

  for (const key of Object.keys(obj)) {
    if (KNOWN_CONFIG_KEYS.includes(key as keyof Config)) {
      filtered[key] = obj[key];
    } else {
      unknownKeys.push(key);
    }
  }

  if (unknownKeys.length > 0) {
    console.info(`Removing unknown config fields: ${unknownKeys.join(", ")}`);
  }

  return filtered as Partial<Config>;
}

function getConfigDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfigHome, "lingo");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function getDbPath(): string {
  return join(getConfigDir(), "data.db");
}

// Server version from package.json (imported at build time)
import pkg from "../package.json";

export const SERVER_VERSION = pkg.version;

export function ensureConfigDir(): void {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    try {
      mkdirSync(configDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create config directory ${configDir}:`, error);
      throw error;
    }
  }
}

export function loadConfig(): Config {
  ensureConfigDir();
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    const raw = JSON.parse(content) as Record<string, unknown>;

    // Filter out unknown fields
    const loaded = filterUnknownFields(raw);
    const merged = { ...DEFAULT_CONFIG, ...loaded };

    // Validate the merged config
    const result = ConfigSchema.safeParse(merged);
    if (!result.success) {
      console.error("Config validation failed, using defaults. Errors:", formatZodErrors(result.error));
      console.error("Please fix your config at:", configPath);
      return DEFAULT_CONFIG;
    }

    // Sync config file if unknown fields were removed or defaults were added
    const rawKeys = Object.keys(raw);
    const loadedKeys = Object.keys(loaded);
    const defaultKeys = Object.keys(DEFAULT_CONFIG);
    if (rawKeys.length !== loadedKeys.length || loadedKeys.length < defaultKeys.length) {
      console.info("Syncing config file");
      saveConfig(merged);
    }

    return merged;
  } catch (error) {
    console.error("Failed to parse config:", error);
    console.error("Please fix your config at:", configPath);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error(`Failed to save config to ${configPath}:`, error);
    throw error;
  }
}

let cachedConfig: Config | null = null;
let configWatcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

type ConfigChangeCallback = (config: Config) => void;
const configChangeCallbacks = new Set<ConfigChangeCallback>();

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function reloadConfig(): Config {
  const oldConfig = cachedConfig;
  cachedConfig = loadConfig();

  // Notify listeners if config actually changed
  if (oldConfig && JSON.stringify(oldConfig) !== JSON.stringify(cachedConfig)) {
    console.info("Config reloaded:", cachedConfig);
    for (const callback of configChangeCallbacks) {
      try {
        callback(cachedConfig);
      } catch (error) {
        console.error("Error in config change callback:", error);
      }
    }
  }

  return cachedConfig;
}

export function onConfigChange(callback: ConfigChangeCallback): void {
  configChangeCallbacks.add(callback);
}

export function startConfigWatcher(): void {
  if (configWatcher) return;

  ensureConfigDir();
  const configPath = getConfigPath();

  // Ensure config file exists
  if (!existsSync(configPath)) {
    saveConfig(DEFAULT_CONFIG);
  }

  configWatcher = watch(configPath, (eventType) => {
    if (eventType === "change") {
      // Debounce to avoid multiple reloads for a single save
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        reloadConfig();
        debounceTimer = null;
      }, 100);
    }
  });

  console.info(`Watching config file: ${configPath}`);
}

export function stopConfigWatcher(): void {
  // Clear debounce timer to prevent memory leak and stale callbacks
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
    console.info("Config watcher stopped");
  }
  configChangeCallbacks.clear();
}
