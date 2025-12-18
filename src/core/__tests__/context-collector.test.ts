import * as fs from 'fs/promises';
import * as path from 'path';
import {
  executeContextOperation,
  executeContextOperations
} from '../context-collector';
import {
  ListDirectoryOperation,
  SearchContentOperation,
  ReadFileOperation
} from '../operation-schema';
import { startDelimiter, endDelimiter } from '../operation-definitions';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('glob');
jest.mock('../../utils/file-utils');
jest.mock('../../utils/cli-style');
jest.mock('../file-context');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGlob = require('glob');
const mockFileUtils = require('../../utils/file-utils');
const mockFileContext = require('../file-context');

describe('information-collector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'cwd').mockReturnValue('/test/root');
    jest.spyOn(console, 'log').mockImplementation();
  });

  describe('executeContextOperation - list_directory', () => {
    it('应该列出目录内容', async () => {
      const op: ListDirectoryOperation = {
        type: 'list_directory',
        path: 'src'
      };

      mockGlob.glob.mockResolvedValue(['file1.ts', 'file2.ts', 'dir/file3.ts']);

      const result = await executeContextOperation(op);

      expect(result).toContain(startDelimiter('LIST_DIRECTORY_RESULT'));
      expect(result).toContain('path: src');
      expect(result).toContain('file1.ts');
      expect(result).toContain('file2.ts');
      expect(result).toContain(endDelimiter('LIST_DIRECTORY_RESULT'));
    });

    it('应该支持递归列出', async () => {
      const op: ListDirectoryOperation = {
        type: 'list_directory',
        path: 'src',
        recursive: true,
        maxDepth: 2
      };

      mockGlob.glob.mockResolvedValue(['a.ts', 'b/c.ts', 'b/d/e.ts']);

      const result = await executeContextOperation(op);

      expect(mockGlob.glob).toHaveBeenCalledWith('**/*', expect.any(Object));
      expect(result).toContain('a.ts');
      expect(result).toContain('b/c.ts');
      expect(result).toContain('b/d/e.ts');
    });

    it('应该限制返回文件数量', async () => {
      const op: ListDirectoryOperation = {
        type: 'list_directory',
        path: 'src'
      };

      const files = Array.from({ length: 300 }, (_, i) => `file${i}.ts`);
      mockGlob.glob.mockResolvedValue(files);

      const result = await executeContextOperation(op);

      const lines = result.split('\n');
      const fileLines = lines.filter((line) => {
        const trimmed = line.trim();
        return trimmed.startsWith('file') && trimmed.endsWith('.ts');
      });
      expect(fileLines.length).toBe(200);
    });

    it('应该处理目录错误', async () => {
      const op: ListDirectoryOperation = {
        type: 'list_directory',
        path: 'nonexistent'
      };

      mockGlob.glob.mockRejectedValue(new Error('Directory not found'));

      const result = await executeContextOperation(op);

      expect(result).toContain('error: Directory not found');
    });
  });

  describe('executeContextOperation - search_content', () => {
    it('应该搜索文件内容', async () => {
      const op: SearchContentOperation = {
        type: 'search_content',
        path: 'src',
        pattern: 'function'
      };

      mockGlob.glob.mockResolvedValue(['/test/root/src/test.ts']);
      mockFileUtils.isFileIgnored.mockResolvedValue(false);
      mockFs.readFile.mockResolvedValue('line1\nfunction test() {}\nline3');
      mockFileContext.formatFileBlock.mockReturnValue('formatted block');

      const result = await executeContextOperation(op);

      expect(mockGlob.glob).toHaveBeenCalled();
      expect(mockFs.readFile).toHaveBeenCalled();
      expect(result).toContain('formatted block');
    });

    it('应该支持文件模式过滤', async () => {
      const op: SearchContentOperation = {
        type: 'search_content',
        path: 'src',
        pattern: 'test',
        filePattern: '*.ts'
      };

      mockGlob.glob.mockResolvedValue(['/test/root/src/file.ts']);
      mockFileUtils.isFileIgnored.mockResolvedValue(false);
      mockFs.readFile.mockResolvedValue('test content');
      mockFileContext.formatFileBlock.mockReturnValue('block');

      await executeContextOperation(op);

      expect(mockGlob.glob).toHaveBeenCalledWith('*.ts', expect.any(Object));
    });

    it('应该提供上下文行', async () => {
      const op: SearchContentOperation = {
        type: 'search_content',
        path: 'src',
        pattern: 'target',
        contextLines: 2
      };

      mockGlob.glob.mockResolvedValue(['/test/root/src/test.ts']);
      mockFileUtils.isFileIgnored.mockResolvedValue(false);
      mockFs.readFile.mockResolvedValue('line1\nline2\ntarget\nline4\nline5');
      mockFileContext.formatFileBlock.mockImplementation(
        (_path: string, content: string) => content
      );

      const result = await executeContextOperation(op);

      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('target');
      expect(result).toContain('line4');
      expect(result).toContain('line5');
    });

    it('应该跳过被忽略的文件', async () => {
      const op: SearchContentOperation = {
        type: 'search_content',
        path: 'src',
        pattern: 'test'
      };

      mockGlob.glob.mockResolvedValue(['/test/root/src/ignored.ts']);
      mockFileUtils.isFileIgnored.mockResolvedValue(true);

      const result = await executeContextOperation(op);

      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('应该限制匹配数量', async () => {
      const op: SearchContentOperation = {
        type: 'search_content',
        path: 'src',
        pattern: 'test'
      };

      const content = Array.from(
        { length: 50 },
        (_, i) => `test line ${i}`
      ).join('\n');
      mockGlob.glob.mockResolvedValue(['/test/root/src/file.ts']);
      mockFileUtils.isFileIgnored.mockResolvedValue(false);
      mockFs.readFile.mockResolvedValue(content);
      mockFileContext.formatFileBlock.mockReturnValue('formatted block');

      const result = await executeContextOperation(op);

      expect(mockFileContext.formatFileBlock).toHaveBeenCalled();
      expect(result).toContain('formatted block');
    });

    it('应该处理未找到匹配的情况', async () => {
      const op: SearchContentOperation = {
        type: 'search_content',
        path: 'src',
        pattern: 'nonexistent'
      };

      mockGlob.glob.mockResolvedValue(['/test/root/src/test.ts']);
      mockFileUtils.isFileIgnored.mockResolvedValue(false);
      mockFs.readFile.mockResolvedValue('no match here');

      const result = await executeContextOperation(op);

      expect(result).toContain('未找到匹配项');
    });

    it('应该处理搜索错误', async () => {
      const op: SearchContentOperation = {
        type: 'search_content',
        path: 'src',
        pattern: 'test'
      };

      mockGlob.glob.mockRejectedValue(new Error('Search failed'));

      const result = await executeContextOperation(op);

      expect(result).toContain('error: Search failed');
    });
  });

  describe('executeContextOperation - read_file', () => {
    it('应该读取整个文件', async () => {
      const op: ReadFileOperation = {
        type: 'read_file',
        path: 'test.ts'
      };

      mockFs.readFile.mockResolvedValue('file content');
      mockFileContext.formatFileBlock.mockReturnValue('formatted content');

      const result = await executeContextOperation(op);

      expect(mockFs.readFile).toHaveBeenCalledWith(
        path.resolve('/test/root', 'test.ts'),
        'utf-8'
      );
      expect(result).toBe('formatted content');
    });

    it('应该读取指定行范围', async () => {
      const op: ReadFileOperation = {
        type: 'read_file',
        path: 'test.ts',
        start: 2,
        end: 4
      };

      mockFs.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');
      mockFileContext.formatFileBlock.mockImplementation(
        (_path: string, content: string) => content
      );

      const result = await executeContextOperation(op);

      expect(result).toContain('line2');
      expect(result).toContain('line3');
      expect(result).toContain('line4');
      expect(result).not.toContain('line1');
      expect(result).not.toContain('line5');
    });

    it('应该处理开放式范围', async () => {
      const op: ReadFileOperation = {
        type: 'read_file',
        path: 'test.ts',
        start: 3
      };

      mockFs.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');
      mockFileContext.formatFileBlock.mockImplementation(
        (_path: string, content: string) => content
      );

      const result = await executeContextOperation(op);

      expect(result).toContain('line3');
      expect(result).toContain('line4');
      expect(result).toContain('line5');
    });

    it('应该包含注释', async () => {
      const op: ReadFileOperation = {
        type: 'read_file',
        path: 'test.ts',
        comment: 'important file'
      };

      mockFs.readFile.mockResolvedValue('content');
      mockFileContext.formatFileBlock.mockReturnValue('block with comment');

      const result = await executeContextOperation(op);

      expect(mockFileContext.formatFileBlock).toHaveBeenCalledWith(
        'test.ts',
        'content',
        expect.objectContaining({ comment: 'important file' })
      );
    });

    it('应该处理读取错误', async () => {
      const op: ReadFileOperation = {
        type: 'read_file',
        path: 'nonexistent.ts'
      };

      mockFs.readFile.mockRejectedValue(new Error('File not found'));
      mockFileContext.formatFileBlock.mockImplementation(
        (_path: string, content: string) => content
      );

      const result = await executeContextOperation(op);

      expect(result).toContain('error: File not found');
    });
  });

  describe('executeContextOperations', () => {
    it('应该批量执行多个操作', async () => {
      const operations = [
        { type: 'list_directory' as const, path: 'src' },
        { type: 'read_file' as const, path: 'test.ts' }
      ];

      mockGlob.glob.mockResolvedValue(['file.ts']);
      mockFs.readFile.mockResolvedValue('content');
      mockFileContext.formatFileBlock.mockReturnValue('block');

      const result = await executeContextOperations(operations);

      expect(result).toContain(startDelimiter('LIST_DIRECTORY_RESULT'));
      expect(result).toContain('block');
    });

    it('应该用换行分隔结果', async () => {
      const operations = [
        { type: 'read_file' as const, path: 'file1.ts' },
        { type: 'read_file' as const, path: 'file2.ts' }
      ];

      mockFs.readFile.mockResolvedValue('content');
      mockFileContext.formatFileBlock
        .mockReturnValueOnce('block1')
        .mockReturnValueOnce('block2');

      const result = await executeContextOperations(operations);

      expect(result).toBe('block1\n\nblock2');
    });

    it('应该处理空操作数组', async () => {
      const result = await executeContextOperations([]);

      expect(result).toBe('');
    });
  });
});
