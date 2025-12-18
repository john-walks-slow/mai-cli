import { TemplateManager } from '../template-manager';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');

describe('Template Manager', () => {
  describe('extractDescription', () => {
    it('should extract HTML comment description', () => {
      const content = '<!-- 描述: Test template -->\nContent';
      const desc = TemplateManager.extractDescription(content);
      expect(desc).toBe('Test template');
    });

    it('should extract single line comment description', () => {
      const content = '// 描述: Test template\nContent';
      const desc = TemplateManager.extractDescription(content);
      expect(desc).toBe('Test template');
    });

    it('should return undefined for no description', () => {
      const content = 'Just content';
      const desc = TemplateManager.extractDescription(content);
      expect(desc).toBeUndefined();
    });
  });

  describe('isValidTemplateName', () => {
    it('should accept valid names', () => {
      expect(TemplateManager.isValidTemplateName('test')).toBe(true);
      expect(TemplateManager.isValidTemplateName('test-template')).toBe(true);
      expect(TemplateManager.isValidTemplateName('test_123')).toBe(true);
    });

    it('should reject invalid names', () => {
      expect(TemplateManager.isValidTemplateName('test/path')).toBe(false);
      expect(TemplateManager.isValidTemplateName('test:name')).toBe(false);
      expect(TemplateManager.isValidTemplateName('')).toBe(false);
      expect(TemplateManager.isValidTemplateName('a'.repeat(51))).toBe(false);
    });
  });

  describe('listTemplates', () => {
    it('should return empty array when no templates', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue([]);
      const templates = await TemplateManager.listTemplates();
      expect(templates).toEqual([]);
    });

    it('should filter non-template files', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue(['test.txt', 'test.md', 'other.js']);
      (fs.stat as jest.Mock).mockResolvedValue({ isFile: () => true });
      (fs.readFile as jest.Mock).mockResolvedValue('content');
      
      const templates = await TemplateManager.listTemplates();
      expect(templates.length).toBe(2);
    });
  });
});