import { replaceInFile, computeFindMatchCount, isFileIgnored } from '../file-utils';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');
jest.mock('../cli-style');
jest.mock('../config-manager', () => ({
  getFollowGitIgnore: jest.fn().mockResolvedValue(false)
}));

describe('File Utils', () => {
  describe('replaceInFile', () => {
    it('should replace content when find matches once', () => {
      const original = 'Hello World\nTest Line\nEnd';
      const result = replaceInFile(original, 'New Line', 'Test Line');
      expect(result).toBe('Hello World\nNew Line\nEnd');
    });

    it('should throw when find has no matches', () => {
      const original = 'Hello World';
      expect(() => replaceInFile(original, 'New', 'NotFound')).toThrow(
        '未找到匹配项'
      );
    });

    it('should throw when find has multiple matches', () => {
      const original = 'Test\nTest\nTest';
      expect(() => replaceInFile(original, 'New', 'Test')).toThrow(
        '找到多个匹配项'
      );
    });

    it('should replace entire content when find is undefined', () => {
      const original = 'Old Content';
      const result = replaceInFile(original, 'New Content');
      expect(result).toBe('New Content');
    });

    it('should handle line endings correctly', () => {
      const original = 'Line1\r\nLine2\r\nLine3';
      const result = replaceInFile(original, 'NewLine', 'Line2');
      expect(result).toBe('Line1\r\nNewLine\r\nLine3');
    });
  });

  describe('computeFindMatchCount', () => {
    it('should count single match', () => {
      const count = computeFindMatchCount('Hello World', 'World');
      expect(count).toBe(1);
    });

    it('should count multiple matches', () => {
      const count = computeFindMatchCount('Test Test Test', 'Test');
      expect(count).toBe(3);
    });

    it('should return 0 for no matches', () => {
      const count = computeFindMatchCount('Hello', 'World');
      expect(count).toBe(0);
    });

    it('should handle line endings in find text', () => {
      const content = 'Line1\r\nLine2\r\nLine3';
      const count = computeFindMatchCount(content, 'Line1\nLine2');
      expect(count).toBe(1);
    });
  });

  describe('isFileIgnored', () => {
    const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
    
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should ignore files matching positive patterns', async () => {
      mockReadFile.mockResolvedValue('**/__tests__/**\n');
      const result = await isFileIgnored('src/utils/__tests__/file.test.ts');
      expect(result).toBe(true);
    });

    it('should not ignore files with negative patterns', async () => {
      mockReadFile.mockResolvedValue('**/__tests__/**\n!**/__tests__/important.test.ts\n');
      const result = await isFileIgnored('src/utils/__tests__/important.test.ts');
      expect(result).toBe(false);
    });

    it('should ignore files matching pattern but not negative pattern', async () => {
      mockReadFile.mockResolvedValue('**/__tests__/**\n!**/__tests__/important.test.ts\n');
      const result = await isFileIgnored('src/utils/__tests__/other.test.ts');
      expect(result).toBe(true);
    });

    it('should not ignore files not matching any pattern', async () => {
      mockReadFile.mockResolvedValue('**/__tests__/**\n');
      const result = await isFileIgnored('src/utils/file-utils.ts');
      expect(result).toBe(false);
    });

    it('should handle empty maiignore file', async () => {
      mockReadFile.mockResolvedValue('');
      const result = await isFileIgnored('src/utils/file-utils.ts');
      expect(result).toBe(false);
    });

    it('should ignore comments and empty lines', async () => {
      mockReadFile.mockResolvedValue('# Comment\n\n**/__tests__/**\n');
      const result = await isFileIgnored('src/utils/__tests__/file.test.ts');
      expect(result).toBe(true);
    });
  });
});
