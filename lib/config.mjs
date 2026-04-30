import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getArg } from './args.mjs';

const DEFAULT_CONFIG_FILES = ['peekr.config.json', '.peekrrc.json'];

export function loadConfig(args = []) {
  const explicitPath = getArg(args, 'config');
  const configPath = explicitPath
    ? resolve(process.cwd(), explicitPath)
    : DEFAULT_CONFIG_FILES.map(name => resolve(process.cwd(), name)).find(path => existsSync(path));

  if (!configPath) return {};

  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read config file ${configPath}: ${err.message}`);
  }
}

function getConfigValue(config, keys) {
  for (const key of keys) {
    if (config?.ports && config.ports[key] != null) return config.ports[key];
    if (config?.[key] != null) return config[key];
  }
  return undefined;
}

export function parsePort(value, label) {
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be a port between 1 and 65535`);
  }
  return port;
}

export function resolvePort(args, config, flagName, configKeys, defaultPort) {
  const cliValue = getArg(args, flagName);
  if (cliValue != null) return parsePort(cliValue, `--${flagName}`);

  const configValue = getConfigValue(config, configKeys);
  if (configValue != null) return parsePort(configValue, `config ${configKeys[0]}`);

  return defaultPort;
}
