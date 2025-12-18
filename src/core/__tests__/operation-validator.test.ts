import { OperationValidator } from '../operation-validator';
import * as fs from 'fs/promises';
import * as fileUtils from '../../utils/file-utils';

jest.mock('fs/promises');
jest.mock('../../utils/file-utils');

describe('Operation Validator', () => {
  describe('validateOperation', () => {
    it('should validate response operation', () => {
      const op = { type: 'response', content: 'Test' };
      const result = OperationValidator.validateOperation(op);
      expect(result.isValid).toBe(true);
    });

    it('should validate create operation', () => {
      const op = { type: 'create', filePath: 'test.ts', content: 'code' };
      const result = OperationValidator.validateOperation(op);
      expect(result.isValid).toBe(true);
    });

    it('should reject operation without type', () => {
      const op = { content: 'Test' };
      const result = OperationValidator.validateOperation(op);
      expect(result.isValid).toBe(false);
    });

    it('should reject create without filePath', () => {
      const op = { type: 'create', content: 'code' };
      const result = OperationValidator.validateOperation(op);
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateOperations', () => {
    it('should validate array of operations', () => {
      const ops = [
        { type: 'response', content: 'Test' },
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      const result = OperationValidator.validateOperations(ops);
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid operations in array', () => {
      const ops = [{ type: 'invalid' }];
      const result = OperationValidator.validateOperations(ops);
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateOperationReachability', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (fileUtils.findGitRoot as jest.Mock).mockResolvedValue('/root');
      (fileUtils.isFileIgnored as jest.Mock).mockResolvedValue(false);
    });

    it('should reject unknown operation type', async () => {
      const op = { type: 'unknown' as any, filePath: 'test.ts' };
      const result = await OperationValidator.validateOperationReachability(op);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('未知操作类型');
    });

    it('should handle validation errors', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('Access denied'));
      const op = { type: 'edit' as const, filePath: 'test.ts', content: '' };
      const result = await OperationValidator.validateOperationReachability(op);
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateOperationsReachability', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      (fileUtils.findGitRoot as jest.Mock).mockResolvedValue('/root');
      (fileUtils.isFileIgnored as jest.Mock).mockResolvedValue(false);
    });

    it('should validate create when file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const ops = [
        { type: 'create' as const, filePath: 'new.ts', content: '' }
      ];
      const result =
        await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(true);
    });

    it('should reject create when file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const ops = [
        { type: 'create' as const, filePath: 'exists.ts', content: '' }
      ];
      const result =
        await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
    });

    it('should reject create without filePath', async () => {
      const ops = [{ type: 'create' as const, content: '' } as any];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('缺少文件路径');
    });

    it('should validate edit when file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('old content');
      (fileUtils.computeFindMatchCount as jest.Mock).mockReturnValue(1);

      const ops = [
        { type: 'edit' as const, filePath: 'test.ts', content: 'new', find: 'old' }
      ];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(true);
    });

    it('should reject edit when find text not found', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('content');
      (fileUtils.computeFindMatchCount as jest.Mock).mockReturnValue(0);

      const ops = [
        { type: 'edit' as const, filePath: 'test.ts', content: 'new', find: 'missing' }
      ];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('找不到要替换的文本');
    });

    it('should reject edit when find has multiple matches', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      (fs.readFile as jest.Mock).mockResolvedValue('test test');
      (fileUtils.computeFindMatchCount as jest.Mock).mockReturnValue(2);

      const ops = [
        { type: 'edit' as const, filePath: 'test.ts', content: 'new', find: 'test' }
      ];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('找到多个匹配项');
    });

    it('should reject edit when file is ignored', async () => {
      (fileUtils.isFileIgnored as jest.Mock).mockResolvedValue(true);
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const ops = [
        { type: 'edit' as const, filePath: 'test.ts', content: 'new' }
      ];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('文件被忽略');
    });

    it('should reject edit without filePath', async () => {
      const ops = [{ type: 'edit' as const, content: 'new' } as any];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
    });

    it('should validate move when paths are valid', async () => {
      (fs.access as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('ENOENT'));

      const ops = [
        { type: 'move' as const, oldPath: 'old.ts', newPath: 'new.ts' }
      ];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(true);
    });

    it('should reject move when target exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const ops = [
        { type: 'move' as const, oldPath: 'old.ts', newPath: 'exists.ts' }
      ];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('目标文件已存在');
    });

    it('should reject move without paths', async () => {
      const ops = [{ type: 'move' as const } as any];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('缺少源路径或目标路径');
    });

    it('should validate delete when file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const ops = [{ type: 'delete' as const, filePath: 'exists.ts' }];
      const result =
        await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(true);
    });

    it('should reject delete when file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const ops = [{ type: 'delete' as const, filePath: 'missing.ts' }];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.[0]).toContain('文件不存在');
    });

    it('should reject delete without filePath', async () => {
      const ops = [{ type: 'delete' as const } as any];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
    });

    it('should collect errors from multiple operations', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);

      const ops = [
        { type: 'create' as const, filePath: 'exists.ts', content: '' },
        { type: 'delete' as const, filePath: 'exists.ts' }
      ];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });
});
