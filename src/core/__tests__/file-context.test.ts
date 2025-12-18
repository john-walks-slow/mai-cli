import * as fs from 'fs/promises';
import * as path from 'path';
import {
  formatFileBlock,
  getFileContext,
  formatFileContexts,
  FileContextItem
} from '../file-context';
import { startDelimiter, endDelimiter } from '../operation-definitions';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('glob');
jest.mock('../../utils/file-utils');
jest.mock('../../utils/cli-style');

const mockFs = fs as jest.Mocked<typeof fs>;
const mockGlob = require('glob');
const mockFileUtils = require('../../utils/file-utils');

describe('file-context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'cwd').mockReturnValue('/test/root');
    jest.spyOn(console, 'log').mockImplementation();
  });

  describe('formatFileBlock', () => {
    it('应该格式化基本文件块', () => {
      const result = formatFileBlock('test.ts', 'content here');
      
      expect(result).toContain(startDelimiter('FILE'));
      expect(result).toContain(startDelimiter('metadata'));
      expect(result).toContain('path: test.ts');
      expect(result).toContain(endDelimiter('metadata'));
      expect(result).toContain(startDelimiter('content'));
      expect(result).toContain('content here');
      expect(result).toContain(endDelimiter('content'));
      expect(result).toContain(endDelimiter('FILE'));
    });

    it('应该包含范围信息', () => {
      const result = formatFileBlock('test.ts', 'content', { range: '1-10' });
      
      expect(result).toContain('range: 1-10');
    });

    it('应该包含注释信息', () => {
      const result = formatFileBlock('test.ts', 'content', { comment: 'test comment' });
      
      expect(result).toContain('comment: test comment');
    });

    it('应该同时包含范围和注释', () => {
      const result = formatFileBlock('test.ts', 'content', {
        range: '5-15',
        comment: 'important section'
      });
      
      expect(result).toContain('range: 5-15');
      expect(result).toContain('comment: important section');
    });
  });

  describe('getFileContext', () => {
    it('应该处理 glob 模式', async () => {
      mockGlob.glob.mockResolvedValue(['/test/root/file1.ts', '/test/root/file2.ts']);
      mockFileUtils.isFileIgnored.mockResolvedValue(false);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('file content');

      const result = await getFileContext(['*.ts']);

      expect(mockGlob.glob).toHaveBeenCalledWith('*.ts', expect.any(Object));
      expect(result).toContain('file1.ts');
      expect(result).toContain('file2.ts');
    });

    it('应该过滤被忽略的文件', async () => {
      mockGlob.glob.mockResolvedValue(['/test/root/file1.ts', '/test/root/ignored.ts']);
      mockFileUtils.isFileIgnored
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('content');

      const result = await getFileContext(['*.ts']);

      expect(result).toContain('file1.ts');
      expect(result).not.toContain('ignored.ts');
    });

    it('应该解析文件范围', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

      const result = await getFileContext(['test.ts:2-4']);

      expect(result).toContain('range: 2-4');
      expect(result).toContain('line2\nline3\nline4');
    });

    it('应该处理开放式范围', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('line1\nline2\nline3');

      const result = await getFileContext(['test.ts:2-']);

      expect(result).toContain('range: 2-end');
      expect(result).toContain('line2\nline3');
    });

    it('应该处理多个文件模式', async () => {
      mockGlob.glob
        .mockResolvedValueOnce(['/test/root/a.ts'])
        .mockResolvedValueOnce(['/test/root/b.js']);
      mockFileUtils.isFileIgnored.mockResolvedValue(false);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('content');

      const result = await getFileContext(['*.ts', '*.js']);

      expect(result).toContain('a.ts');
      expect(result).toContain('b.js');
    });

    it('应该处理不存在的文件', async () => {
      mockFs.access.mockRejectedValue(new Error('File not found'));

      const result = await getFileContext(['nonexistent.ts']);

      expect(result).toBe('');
    });

    it('应该合并重叠的范围', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

      const result = await getFileContext(['test.ts:2-4', 'test.ts:3-5']);

      expect(result).toContain('range: 3-4');
    });

    it('应该处理无交集的范围', async () => {
      mockFs.access.mockResolvedValue(undefined);

      const result = await getFileContext(['test.ts:5-10', 'test.ts:1-3']);

      expect(result).toBe('');
    });
  });

  describe('formatFileContexts', () => {
    it('应该格式化单个文件', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('file content');

      const items: FileContextItem[] = [{ path: 'test.ts' }];
      const result = await formatFileContexts(items);

      expect(result).toContain('test.ts');
      expect(result).toContain('file content');
    });

    it('应该格式化多个文件', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile
        .mockResolvedValueOnce('content1')
        .mockResolvedValueOnce('content2');

      const items: FileContextItem[] = [
        { path: 'file1.ts' },
        { path: 'file2.ts' }
      ];
      const result = await formatFileContexts(items);

      expect(result).toContain('file1.ts');
      expect(result).toContain('content1');
      expect(result).toContain('file2.ts');
      expect(result).toContain('content2');
    });

    it('应该处理带范围的文件', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5');

      const items: FileContextItem[] = [
        { path: 'test.ts', start: 2, end: 4 }
      ];
      const result = await formatFileContexts(items);

      expect(result).toContain('range: 2-4');
      expect(result).toContain('line2\nline3\nline4');
    });

    it('应该包含注释', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('content');

      const items: FileContextItem[] = [
        { path: 'test.ts', comment: 'important file' }
      ];
      const result = await formatFileContexts(items);

      expect(result).toContain('comment: important file');
    });

    it('应该跳过目录', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => true } as any);

      const items: FileContextItem[] = [{ path: 'dir' }];
      const result = await formatFileContexts(items);

      expect(result).toBe('');
    });

    it('应该处理读取错误', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockRejectedValue(new Error('Read error'));

      const items: FileContextItem[] = [{ path: 'test.ts' }];
      const result = await formatFileContexts(items);

      expect(result).toBe('');
    });

    it('应该处理空范围', async () => {
      mockFs.stat.mockResolvedValue({ isDirectory: () => false } as any);
      mockFs.readFile.mockResolvedValue('line1\nline2');

      const items: FileContextItem[] = [
        { path: 'test.ts', start: 10, end: 20 }
      ];
      const result = await formatFileContexts(items);

      expect(result).toBe('');
    });

    it('应该返回空字符串当没有有效项时', async () => {
      const items: FileContextItem[] = [];
      const result = await formatFileContexts(items);

      expect(result).toBe('');
    });
  });
});