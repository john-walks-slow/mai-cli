import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import JSON5 from 'json5';
import { CliStyle } from './cli-style';
import { MAI_CONFIG_DIR_NAME, CONFIG_FILE_NAME } from '../constants/mai-data';
import {
  ConfigSchema,
  MaiConfig,
  ProvidersConfig,
  DEFAULT_CONFIG,
  DEFAULT_PROVIDERS,
  CONFIG_METADATA
} from './config-schema';

export type { MaiConfig, ProvidersConfig };
export { DEFAULT_PROVIDERS, CONFIG_METADATA };

let configCache: MaiConfig | null = null;

export function getMaiConfigDir(): string {
  return path.join(os.homedir(), MAI_CONFIG_DIR_NAME);
}

export function getConfigFile(): string {
  return path.join(getMaiConfigDir(), CONFIG_FILE_NAME);
}

export async function loadConfig(): Promise<MaiConfig> {
  if (configCache) return configCache;

  const configPath = getConfigFile();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON5.parse(content);
    const validated = ConfigSchema.parse(parsed);
    configCache = validated;
    return validated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    console.warn(`Warning: Unable to load config '${configPath}'. Falling back to defaults.`);
    return {};
  }
}

export async function saveConfig(config: MaiConfig): Promise<void> {
  const configDir = getMaiConfigDir();
  const configPath = getConfigFile();
  try {
    const validated = ConfigSchema.parse(config);
    await fs.mkdir(configDir, { recursive: true });
    const content = JSON.stringify(validated, null, 2);
    await fs.writeFile(configPath, content, 'utf-8');
    configCache = validated;
  } catch (error) {
    console.error(CliStyle.error(`保存配置失败: ${(error as Error).message}`));
    throw error;
  }
}

export function resetConfigCache(): void {
  configCache = null;
}

// 统一的配置访问
export async function getConfigValue<K extends keyof MaiConfig>(
  key: K
): Promise<MaiConfig[K]> {
  const config = await loadConfig();
  return config[key] ?? (DEFAULT_CONFIG[key] as MaiConfig[K]);
}

export async function setConfigValue<K extends keyof MaiConfig>(
  key: K,
  value: MaiConfig[K]
): Promise<void> {
  const config = await loadConfig();
  (config as any)[key] = value;
  await saveConfig(config);
}

// 嵌套配置访问（如 autoContext.maxRounds）
export async function getNestedConfig(path: string): Promise<any> {
  const config = await loadConfig();
  const keys = path.split('.');
  let value: any = config;
  
  for (const key of keys) {
    value = value?.[key];
  }
  
  if (value === undefined) {
    let defaultValue: any = DEFAULT_CONFIG;
    for (const key of keys) {
      defaultValue = defaultValue?.[key];
    }
    return defaultValue;
  }
  
  return value;
}

export async function setNestedConfig(path: string, value: any): Promise<void> {
  const config = await loadConfig();
  const keys = path.split('.');
  let target: any = config;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!target[key]) target[key] = {};
    target = target[key];
  }
  
  target[keys[keys.length - 1]] = value;
  await saveConfig(config);
}

// Model 相关
export async function parseModel(
  model: string
): Promise<{ provider: string; modelName: string } | null> {
  const config = await loadConfig();
  const customProviders = config.providers || {};
  const mergedProviders =
    Object.keys(customProviders).length > 0 ? customProviders : DEFAULT_PROVIDERS;

  for (const provider of Object.keys(mergedProviders)) {
    if (model.startsWith(`${provider}/`)) {
      return { provider, modelName: model.slice(provider.length + 1) };
    }
  }
  return null;
}

export async function getCurrentModel(): Promise<string> {
  const envModel = process.env.MAI_MODEL;
  if (envModel) {
    const available = await getAvailableModels();
    if (available.includes(envModel)) return envModel;
  }

  const configModel = await getConfigValue('model');
  if (configModel && typeof configModel === 'string') {
    const available = await getAvailableModels();
    if (available.includes(configModel)) return configModel;
  }

  return (DEFAULT_CONFIG.model as string) || 'openai/gpt-4o';
}

export async function getAvailableModels(): Promise<string[]> {
  const config = await loadConfig();
  const customProviders = config.providers || {};
  const mergedProviders =
    Object.keys(customProviders).length > 0 ? customProviders : DEFAULT_PROVIDERS;

  const models: string[] = [];
  for (const [provider, def] of Object.entries(mergedProviders)) {
    const providerModels = def.models || [];
    for (const model of providerModels) {
      models.push(`${provider}/${model}`);
    }
  }
  return models;
}

export async function getApiEndpoint(model?: string): Promise<string> {
  const currentModel = model || (await getCurrentModel());
  const parsed = await parseModel(currentModel);
  if (!parsed) {
    throw new Error(`Invalid model format: ${currentModel}`);
  }

  const config = await loadConfig();
  const customProviders = config.providers || {};
  const mergedProviders =
    Object.keys(customProviders).length > 0 ? customProviders : DEFAULT_PROVIDERS;

  const provider = (mergedProviders as any)[parsed.provider];
  if (!provider) {
    throw new Error(`Unknown provider: ${parsed.provider}`);
  }

  return provider.url;
}

export async function getApiKey(model?: string): Promise<string> {
  const currentModel = model || (await getCurrentModel());
  const parsed = await parseModel(currentModel);
  if (!parsed) {
    throw new Error(`Invalid model format: ${currentModel}`);
  }

  const config = await loadConfig();
  const customProviders = config.providers || {};
  const mergedProviders =
    Object.keys(customProviders).length > 0 ? customProviders : DEFAULT_PROVIDERS;

  const provider = (mergedProviders as any)[parsed.provider];
  if (!provider) {
    throw new Error(`Unknown provider: ${parsed.provider}`);
  }

  if (provider.apiKey) return provider.apiKey;

  const key = process.env[provider.apiKeyEnv];
  if (!key) {
    throw new Error(`API key not found. Set ${provider.apiKeyEnv}.`);
  }

  const keys = key.split(',').map(k => k.trim()).filter(k => k);
  return keys.length > 1 ? keys[Math.floor(Math.random() * keys.length)] : key;
}

export async function hasApiKey(model: string): Promise<boolean> {
  try {
    await getApiKey(model);
    return true;
  } catch {
    return false;
  }
}

// 兼容旧API的辅助函数
export async function getHistoryDepth(): Promise<number> {
  const value = await getConfigValue('historyDepth');
  return typeof value === 'number' ? value : 0;
}

export async function getSystemPrompt(): Promise<string | undefined> {
  const value = await getConfigValue('systemPrompt');
  return typeof value === 'string' ? value : undefined;
}

export async function getTemperature(): Promise<number> {
  const value = await getConfigValue('temperature');
  return typeof value === 'number' ? value : 0.7;
}

export async function getAutoContextConfig(): Promise<{
  maxRounds: number;
  maxFiles: number;
}> {
  const config = await loadConfig();
  const autoContext = config.autoContext as any;
  return {
    maxRounds: autoContext?.maxRounds ?? 10,
    maxFiles: autoContext?.maxFiles ?? 20
  };
}

export async function setModel(model: string): Promise<void> {
  const available = await getAvailableModels();
  if (!available.includes(model)) {
    throw new Error(`Invalid model: ${model}`);
  }
  await setConfigValue('model', model);
}

export async function getHistoryScope(): Promise<'global' | 'project'> {
  const value = await getConfigValue('historyScope');
  return value === 'project' ? 'project' : 'global';
}

export async function getDiffViewer(): Promise<string> {
  const value = await getConfigValue('diffViewer');
  return typeof value === 'string' ? value : 'code';
}

export async function getFollowGitIgnore(): Promise<boolean> {
  const value = await getConfigValue('followGitIgnore');
  return typeof value === 'boolean' ? value : true;
}

export async function getCurrentModelName(): Promise<string | null> {
  const currentModel = await getCurrentModel();
  const parsed = await parseModel(currentModel);
  return parsed ? parsed.modelName : null;
}

export async function getCurrentProvider(): Promise<string | null> {
  const currentModel = await getCurrentModel();
  const parsed = await parseModel(currentModel);
  return parsed ? parsed.provider : null;
}