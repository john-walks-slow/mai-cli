import { openInEditor, showDiffInVsCode } from '../editor-utils';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import * as config from '../../config';

jest.mock('fs/promises');
jest.mock('child_process');
jest.mock('../../config');
jest.mock('../cli-style');

describe('editor-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('openInEditor', () => {
    it('应该在编辑器中打开内容', async () => {
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('edited content');
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await openInEditor('original content');
      
      expect(result).toBe('edited content');
      expect(fs.writeFile).toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledWith('code', expect.any(Array), expect.any(Object));
    });

    it('应该在失败时清理临时文件', async () => {
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(1);
        })
      };
      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      await expect(openInEditor('content')).rejects.toThrow();
      expect(fs.unlink).toHaveBeenCalled();
    });
  });

  describe('showDiffInVsCode', () => {
    beforeEach(() => {
      (config.getDiffViewer as jest.Mock).mockResolvedValue('code');
    });

    it('应该显示 diff 并返回编辑后的内容', async () => {
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('modified content');
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await showDiffInVsCode('original', 'new', 'test.ts');
      
      expect(result).toBe('modified content');
    });

    it('应该在没有修改时返回 null', async () => {
      const mockProcess = {
        on: jest.fn((event, callback) => {
          if (event === 'exit') callback(0);
        })
      };
      (spawn as jest.Mock).mockReturnValue(mockProcess);
      (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('new');
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      const result = await showDiffInVsCode('original', 'new');
      
      expect(result).toBeNull();
    });

    it('应该在错误时返回 null', async () => {
      (fs.mkdir as jest.Mock).mockRejectedValue(new Error('mkdir failed'));

      const result = await showDiffInVsCode('original', 'new');
      
      expect(result).toBeNull();
    });
  });
});