import { parseModel, getAvailableModels } from '../config-manager';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

describe('Config Manager', () => {
  describe('parseModel', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue('{}');
    });

    it('should parse openai model', async () => {
      const result = await parseModel('openai/gpt-4o');
      expect(result).toEqual({ provider: 'openai', modelName: 'gpt-4o' });
    });

    it('should handle model name with slashes', async () => {
      const result = await parseModel('openai/gpt-4o/mini');
      expect(result).toEqual({ provider: 'openai', modelName: 'gpt-4o/mini' });
    });

    it('should return null for invalid format', async () => {
      const result = await parseModel('invalid-model');
      expect(result).toBeNull();
    });
  });

  describe('getAvailableModels', () => {
    beforeEach(() => {
      (fs.readFile as jest.Mock).mockResolvedValue('{}');
    });

    it('should return default models', async () => {
      const models = await getAvailableModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models[0]).toContain('/');
    });
  });
});