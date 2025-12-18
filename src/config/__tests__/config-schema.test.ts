import { ConfigSchema, ProviderConfigSchema, CONFIG_METADATA } from '../config-schema';

describe('Config Schema', () => {
  describe('ProviderConfigSchema', () => {
    it('should validate valid provider config', () => {
      const validProvider = {
        url: 'https://api.example.com',
        models: ['model1', 'model2'],
        apiKeyEnv: 'API_KEY',
        apiKey: 'test-key'
      };
      
      const result = ProviderConfigSchema.safeParse(validProvider);
      expect(result.success).toBe(true);
    });

    it('should validate provider without optional fields', () => {
      const minimalProvider = {
        url: 'https://api.example.com',
        apiKeyEnv: 'API_KEY'
      };
      
      const result = ProviderConfigSchema.safeParse(minimalProvider);
      expect(result.success).toBe(true);
    });

    it('should reject provider without url', () => {
      const invalid = {
        apiKeyEnv: 'API_KEY'
      };
      
      const result = ProviderConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject provider without apiKeyEnv', () => {
      const invalid = {
        url: 'https://api.example.com'
      };
      
      const result = ProviderConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('ConfigSchema', () => {
    it('should validate complete config', () => {
      const validConfig = {
        providers: {
          openai: {
            url: 'https://api.openai.com/v1',
            models: ['gpt-4o'],
            apiKeyEnv: 'OPENAI_API_KEY'
          }
        },
        model: 'openai/gpt-4o',
        temperature: 0.8,
        historyDepth: 5,
        historyScope: 'global',
        diffViewer: 'code',
        followGitIgnore: true,
        autoContext: {
          enabled: true,
          maxRounds: 20,
          maxOperations: 40
        }
      };
      
      const result = ConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should apply default values for optional fields', () => {
      const minimalConfig = {
        providers: {},
        model: 'test/model'
      };
      const result = ConfigSchema.parse(minimalConfig);
      
      expect(result.historyDepth).toBe(0);
      expect(result.temperature).toBe(0.7);
      expect(result.historyScope).toBe('global');
      expect(result.diffViewer).toBe('code');
      expect(result.followGitIgnore).toBe(true);
      expect(result.autoContext).toEqual({
        enabled: true,
        maxRounds: 20,
        maxOperations: 40
      });
    });

    it('should reject invalid temperature', () => {
      const invalid = { temperature: 3 };
      const result = ConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid historyDepth', () => {
      const invalid = { historyDepth: -1 };
      const result = ConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject invalid historyScope', () => {
      const invalid = { historyScope: 'invalid' };
      const result = ConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate autoContext with custom values', () => {
      const config = {
        providers: {},
        model: 'test/model',
        autoContext: {
          enabled: false,
          maxRounds: 10,
          maxOperations: 20
        }
      };
      
      const result = ConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should reject invalid autoContext.maxRounds', () => {
      const invalid = {
        autoContext: {
          enabled: true,
          maxRounds: 0,
          maxOperations: 40
        }
      };
      
      const result = ConfigSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('CONFIG_METADATA', () => {
    it('should have metadata for all config fields', () => {
      expect(CONFIG_METADATA.model).toBeDefined();
      expect(CONFIG_METADATA.systemPrompt).toBeDefined();
      expect(CONFIG_METADATA.historyDepth).toBeDefined();
      expect(CONFIG_METADATA.temperature).toBeDefined();
      expect(CONFIG_METADATA.historyScope).toBeDefined();
      expect(CONFIG_METADATA.diffViewer).toBeDefined();
      expect(CONFIG_METADATA.followGitIgnore).toBeDefined();
    });

    it('should have metadata for nested autoContext fields', () => {
      expect(CONFIG_METADATA['autoContext.enabled']).toBeDefined();
      expect(CONFIG_METADATA['autoContext.maxRounds']).toBeDefined();
      expect(CONFIG_METADATA['autoContext.maxOperations']).toBeDefined();
    });

    it('should have correct metadata structure', () => {
      const meta = CONFIG_METADATA.model;
      expect(meta.name).toBe('AI 模型');
      expect(meta.description).toBeDefined();
      expect(meta.type).toBe('select');
    });
  });
});