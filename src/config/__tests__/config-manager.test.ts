import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import JSON5 from 'json5';
import {
  loadConfig,
  saveConfig,
  resetConfigCache,
  getConfigValue,
  setConfigValue,
  getNestedConfig,
  setNestedConfig,
  parseModel,
  getCurrentModel,
  getAvailableModels,
  getApiEndpoint,
  getApiKey,
  hasApiKey,
  getMaiConfigDir,
  getConfigFile
} from '../config-manager';
import { MaiConfig } from '../config-schema';

jest.mock('fs/promises');
jest.mock('os');

const mockConfig: MaiConfig = {
  providers: {
    openai: {
      url: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini'],
      apiKeyEnv: 'OPENAI_API_KEY',
      apiKey: 'test-key'
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/v1',
      models: ['gemini-2.5-flash'],
      apiKeyEnv: 'GEMINI_API_KEY'
    }
  },
  model: 'openai/gpt-4o',
  temperature: 0.8,
  historyDepth: 0,
  historyScope: 'global',
  diffViewer: 'code',
  followGitIgnore: true,
  autoContext: {
    enabled: true,
    maxRounds: 20,
    maxOperations: 40
  }
};

describe('Config Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetConfigCache();
    (os.homedir as jest.Mock).mockReturnValue('/home/user');
  });

  describe('getMaiConfigDir', () => {
    it('should return correct config directory', () => {
      const result = getMaiConfigDir();
      expect(result).toContain('.mai');
      expect(result).toContain('user');
    });
  });

  describe('getConfigFile', () => {
    it('should return correct config file path', () => {
      const result = getConfigFile();
      expect(result).toContain('.mai');
      expect(result).toContain('config.json5');
    });
  });

  describe('loadConfig', () => {
    it('should load and parse config file', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      const config = await loadConfig();
      expect(config).toEqual(mockConfig);
    });

    it('should cache config after first load', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      await loadConfig();
      await loadConfig();
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('should throw error when config file does not exist', async () => {
      const error: any = new Error('ENOENT');
      error.code = 'ENOENT';
      (fs.readFile as jest.Mock).mockRejectedValue(error);
      
      await expect(loadConfig()).rejects.toThrow('配置文件不存在');
      await expect(loadConfig()).rejects.toThrow('mai config init');
    });

    it('should throw error when config file is invalid', async () => {
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('Parse error'));
      await expect(loadConfig()).rejects.toThrow('无法加载配置文件');
    });
  });

  describe('saveConfig', () => {
    it('should save config to file', async () => {
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      
      await saveConfig(mockConfig);
      
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = (fs.writeFile as jest.Mock).mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      expect(writtenContent).toEqual(mockConfig);
      expect(writeCall[2]).toBe('utf-8');
    });

    it('should throw error on save failure', async () => {
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockRejectedValue(new Error('Write error'));
      
      await expect(saveConfig(mockConfig)).rejects.toThrow();
    });
  });

  describe('getConfigValue', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
    });

    it('should get config value', async () => {
      const model = await getConfigValue('model');
      expect(model).toBe('openai/gpt-4o');
    });

    it('should return undefined for missing value', async () => {
      const value = await getConfigValue('systemPrompt');
      expect(value).toBeUndefined();
    });
  });

  describe('setConfigValue', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    });

    it('should set config value', async () => {
      await setConfigValue('temperature', 0.5);
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('getNestedConfig', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
    });

    it('should get nested config value', async () => {
      const value = await getNestedConfig('autoContext.maxRounds');
      expect(value).toBe(20);
    });

    it('should return undefined for missing nested value', async () => {
      const value = await getNestedConfig('autoContext.missing');
      expect(value).toBeUndefined();
    });
  });

  describe('setNestedConfig', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    });

    it('should set nested config value', async () => {
      await setNestedConfig('autoContext.maxRounds', 30);
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('parseModel', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
    });

    it('should parse valid model string', async () => {
      const result = await parseModel('openai/gpt-4o');
      expect(result).toEqual({
        provider: 'openai',
        modelName: 'gpt-4o'
      });
    });

    it('should return null for invalid model format', async () => {
      const result = await parseModel('invalid-model');
      expect(result).toBeNull();
    });

    it('should return null for unknown provider', async () => {
      const result = await parseModel('unknown/model');
      expect(result).toBeNull();
    });
  });

  describe('getCurrentModel', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      delete process.env.MAI_MODEL;
    });

    it('should return model from environment variable', async () => {
      process.env.MAI_MODEL = 'openai/gpt-4o-mini';
      const model = await getCurrentModel();
      expect(model).toBe('openai/gpt-4o-mini');
    });

    it('should return model from config', async () => {
      const model = await getCurrentModel();
      expect(model).toBe('openai/gpt-4o');
    });

    it('should throw error when no model configured', async () => {
      const configWithoutModel = { ...mockConfig };
      delete (configWithoutModel as any).model;
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(configWithoutModel));
      resetConfigCache();
      
      await expect(getCurrentModel()).rejects.toThrow();
    });
  });

  describe('getAvailableModels', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
    });

    it('should return all available models', async () => {
      const models = await getAvailableModels();
      expect(models).toEqual([
        'openai/gpt-4o',
        'openai/gpt-4o-mini',
        'gemini/gemini-2.5-flash'
      ]);
    });

    it('should return empty array when no providers', async () => {
      const emptyConfig = { ...mockConfig, providers: {} };
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(emptyConfig));
      resetConfigCache();
      
      const models = await getAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe('getApiEndpoint', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
    });

    it('should return API endpoint for model', async () => {
      const endpoint = await getApiEndpoint('openai/gpt-4o');
      expect(endpoint).toBe('https://api.openai.com/v1');
    });

    it('should throw error for invalid model format', async () => {
      await expect(getApiEndpoint('invalid')).rejects.toThrow('Invalid model format');
    });

    it('should throw error for unknown provider', async () => {
      await expect(getApiEndpoint('unknown/model')).rejects.toThrow();
    });
  });

  describe('getApiKey', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      delete process.env.OPENAI_API_KEY;
      delete process.env.GEMINI_API_KEY;
    });

    it('should return API key from config', async () => {
      const key = await getApiKey('openai/gpt-4o');
      expect(key).toBe('test-key');
    });

    it('should return API key from environment', async () => {
      process.env.GEMINI_API_KEY = 'env-key';
      const key = await getApiKey('gemini/gemini-2.5-flash');
      expect(key).toBe('env-key');
    });

    it('should handle comma-separated keys', async () => {
      process.env.GEMINI_API_KEY = 'key1,key2,key3';
      const key = await getApiKey('gemini/gemini-2.5-flash');
      expect(['key1', 'key2', 'key3']).toContain(key);
    });

    it('should throw error when API key not found', async () => {
      await expect(getApiKey('gemini/gemini-2.5-flash')).rejects.toThrow('API key not found');
    });

    it('should throw error for invalid model', async () => {
      await expect(getApiKey('invalid')).rejects.toThrow('Invalid model format');
    });
  });

  describe('hasApiKey', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      delete process.env.GEMINI_API_KEY;
    });

    it('should return true when API key exists', async () => {
      const result = await hasApiKey('openai/gpt-4o');
      expect(result).toBe(true);
    });

    it('should return false when API key does not exist', async () => {
      const result = await hasApiKey('gemini/gemini-2.5-flash');
      expect(result).toBe(false);
    });
  });

  describe('resetConfigCache', () => {
    it('should clear config cache', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      await loadConfig();
      resetConfigCache();
      await loadConfig();
      expect(fs.readFile).toHaveBeenCalledTimes(2);
    });
  });

  describe('Helper functions', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockConfig));
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    });

    it('getHistoryDepth should return history depth', async () => {
      const { getHistoryDepth } = require('../config-manager');
      const depth = await getHistoryDepth();
      expect(depth).toBe(0);
    });

    it('getSystemPrompt should return system prompt', async () => {
      const { getSystemPrompt } = require('../config-manager');
      const prompt = await getSystemPrompt();
      expect(prompt).toBeUndefined();
    });

    it('getTemperature should return temperature', async () => {
      const { getTemperature } = require('../config-manager');
      const temp = await getTemperature();
      expect(temp).toBe(0.8);
    });

    it('getAutoContextConfig should return auto context config', async () => {
      const { getAutoContextConfig } = require('../config-manager');
      const config = await getAutoContextConfig();
      expect(config).toEqual({ maxRounds: 20, maxFiles: 20 });
    });

    it('setModel should set model', async () => {
      const { setModel } = require('../config-manager');
      await setModel('openai/gpt-4o-mini');
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('setModel should throw error for invalid model', async () => {
      const { setModel } = require('../config-manager');
      await expect(setModel('invalid/model')).rejects.toThrow('Invalid model');
    });

    it('getHistoryScope should return history scope', async () => {
      const { getHistoryScope } = require('../config-manager');
      const scope = await getHistoryScope();
      expect(scope).toBe('global');
    });

    it('getDiffViewer should return diff viewer', async () => {
      const { getDiffViewer } = require('../config-manager');
      const viewer = await getDiffViewer();
      expect(viewer).toBe('code');
    });

    it('getFollowGitIgnore should return follow git ignore', async () => {
      const { getFollowGitIgnore } = require('../config-manager');
      const follow = await getFollowGitIgnore();
      expect(follow).toBe(true);
    });

    it('getCurrentModelName should return current model name', async () => {
      const { getCurrentModelName } = require('../config-manager');
      const name = await getCurrentModelName();
      expect(name).toBe('gpt-4o');
    });

    it('getCurrentProvider should return current provider', async () => {
      const { getCurrentProvider } = require('../config-manager');
      const provider = await getCurrentProvider();
      expect(provider).toBe('openai');
    });
  });
});