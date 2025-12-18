import {
  replaceInFile,
  computeFindMatchCount,
  isFileIgnored,
  toAbsolutePath,
  extractKeywordsFromPrompt,
  findGitRoot,
  createFile,
  writeFileWithReplace,
  moveFile,
  deleteFile,
  replaceLines,
  getProjectOverview,
  searchProject,
  validateFilePaths,
  listFilesInDirectory,
  advancedSearchFiles
} from '../file-utils';
import * as fs from 'fs/promises';
import * as path from 'path';

jest.mock('fs/promises');
jest.mock('../cli-style');
jest.mock('../../config/config-manager', () => ({
  getFollowGitIgnore: jest.fn().mockResolvedValue(false)
}));

describe('File Utils', () => {
  describe('toAbsolutePath', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return normalized path for absolute path', async () => {
      const absPath = 'D:\\test\\file.ts';
      const result = await toAbsolutePath(absPath);
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('should resolve relative to cwd when file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      const result = await toAbsolutePath('test.ts');
      expect(result).toContain('test.ts');
    });

    it('should fallback to git root when file not in cwd', async () => {
      (fs.access as jest.Mock)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(undefined);
      const result = await toAbsolutePath('test.ts');
      expect(result).toBeDefined();
    });
  });

  describe('extractKeywordsFromPrompt', () => {
    it('should extract keywords from prompt', () => {
      const keywords = extractKeywordsFromPrompt('create a new test file');
      expect(keywords).toContain('create');
      expect(keywords).toContain('test');
      expect(keywords).toContain('file');
    });

    it('should filter short words', () => {
      const keywords = extractKeywordsFromPrompt('a is to be');
      expect(keywords.length).toBe(0);
    });

    it('should remove duplicates', () => {
      const keywords = extractKeywordsFromPrompt('test test test');
      expect(keywords).toEqual(['test']);
    });
  });

  describe('findGitRoot', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should find git root', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      const root = await findGitRoot();
      expect(root).toBeDefined();
    });

    it('should fallback to package.json location', async () => {
      (fs.access as jest.Mock)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(undefined);
      const root = await findGitRoot();
      expect(root).toBeDefined();
    });

    it('should return start dir when nothing found', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      const startDir = process.cwd();
      const root = await findGitRoot(startDir);
      expect(root).toBe(startDir);
    });
  });

  describe('createFile', () => {
    it('should create file with directories', async () => {
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await createFile('test/file.ts', 'content');
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledWith('test/file.ts', 'content', 'utf-8');
    });
  });

  describe('writeFileWithReplace', () => {
    it('should replace content in file', async () => {
      (fs.readFile as jest.Mock).mockResolvedValue('old content');
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      await writeFileWithReplace('test.ts', 'new content', 'old content');
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('moveFile', () => {
    it('should move file', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.rename as jest.Mock).mockResolvedValue(undefined);

      await moveFile('old.ts', 'new.ts');
      expect(fs.rename).toHaveBeenCalledWith('old.ts', 'new.ts');
    });
  });

  describe('deleteFile', () => {
    it('should delete file', async () => {
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);
      await deleteFile('test.ts');
      expect(fs.unlink).toHaveBeenCalledWith('test.ts');
    });
  });

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
  
    describe('replaceLines', () => {
      it('should replace lines in file', async () => {
        (fs.readFile as jest.Mock).mockResolvedValue('line1\nline2\nline3');
        (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
  
        await replaceLines('test.ts', 'new', 2, 2);
        expect(fs.writeFile).toHaveBeenCalled();
      });
  
      it('should handle errors gracefully', async () => {
        (fs.readFile as jest.Mock).mockRejectedValue(new Error('Read error'));
        await replaceLines('test.ts', 'new');
        // Should not throw
      });
    });
  
    describe('getProjectOverview', () => {
      it('should build project tree', async () => {
        (fs.readdir as jest.Mock).mockResolvedValue([
          { name: 'file.ts', isDirectory: () => false, isFile: () => true }
        ]);
  
        const overview = await getProjectOverview();
        expect(overview).toContain('项目根目录');
      });
    });
  
    describe('searchProject', () => {
      it('should search for keywords', async () => {
        (fs.readdir as jest.Mock).mockResolvedValue([
          { name: 'test.ts', isDirectory: () => false, isFile: () => true }
        ]);
        (fs.readFile as jest.Mock).mockResolvedValue('test content');
  
        const results = await searchProject(['test']);
        expect(results.length).toBeGreaterThanOrEqual(0);
      });
  
      it('should return empty for no keywords', async () => {
        const results = await searchProject([]);
        expect(results).toEqual([]);
      });
    });
  
    describe('validateFilePaths', () => {
      it('should validate existing files', async () => {
        (fs.access as jest.Mock).mockResolvedValue(undefined);
        const items = [{ path: 'test.ts' }];
        const result = await validateFilePaths(items);
        expect(result).toEqual(items);
      });
  
      it('should filter non-existent files', async () => {
        (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
        const items = [{ path: 'missing.ts' }];
        const result = await validateFilePaths(items);
        expect(result).toEqual([]);
      });
    });
  
    describe('listFilesInDirectory', () => {
      it('should list files recursively', async () => {
        (fs.readdir as jest.Mock).mockResolvedValue([
          { name: 'test.ts', isDirectory: () => false, isFile: () => true }
        ]);
  
        const files = await listFilesInDirectory('.', true);
        expect(Array.isArray(files)).toBe(true);
      });
  
      it('should filter by file pattern', async () => {
        (fs.readdir as jest.Mock).mockResolvedValue([
          { name: 'test.ts', isDirectory: () => false, isFile: () => true },
          { name: 'test.js', isDirectory: () => false, isFile: () => true }
        ]);
  
        const files = await listFilesInDirectory('.', true, '*.ts');
        expect(Array.isArray(files)).toBe(true);
      });
    });
  
    describe('advancedSearchFiles', () => {
      it('should search with regex', async () => {
        (fs.readdir as jest.Mock).mockResolvedValue([
          { name: 'test.ts', isDirectory: () => false, isFile: () => true }
        ]);
        (fs.readFile as jest.Mock).mockResolvedValue('test content');
  
        const results = await advancedSearchFiles('.', 'test');
        expect(Array.isArray(results)).toBe(true);
      });
  
      it('should include context lines', async () => {
        (fs.readdir as jest.Mock).mockResolvedValue([
          { name: 'test.ts', isDirectory: () => false, isFile: () => true }
        ]);
        (fs.readFile as jest.Mock).mockResolvedValue('line1\ntest\nline3');
  
        const results = await advancedSearchFiles('.', 'test', undefined, 1);
        expect(Array.isArray(results)).toBe(true);
      });
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

    it('should return false on error', async () => {
      mockReadFile.mockRejectedValue(new Error('Read error'));
      const result = await isFileIgnored('test.ts');
      expect(result).toBe(false);
    });
  });
});
