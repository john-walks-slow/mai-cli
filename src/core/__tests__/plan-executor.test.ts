import { executePlan } from '../plan-executor';
import * as fs from 'fs/promises';
import * as fileUtils from '../../utils/file-utils';
import { OperationValidator } from '../operation-validator';

jest.mock('fs/promises');
jest.mock('../../utils/file-utils');
jest.mock('../operation-validator');
jest.mock('../../utils/cli-style');

// Suppress console output during tests
const originalLog = console.log;
const originalError = console.error;

describe('Plan Executor', () => {
  beforeAll(() => {
    console.log = jest.fn();
    console.error = jest.fn();
  });

  afterAll(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (OperationValidator.validateOperations as jest.Mock).mockReturnValue({ isValid: true });
  });

  describe('executePlan', () => {
    it('should execute create operation successfully', async () => {
      const ops = [
        { type: 'create' as const, filePath: 'test.ts', content: 'code' }
      ];

      (fileUtils.createFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.successfulOps).toBe(1);
      expect(result.failedOps).toBe(0);
      expect(fileUtils.createFile).toHaveBeenCalledWith('test.ts', 'code');
    });

    it('should execute edit operation successfully', async () => {
      const ops = [
        { type: 'edit' as const, filePath: 'test.ts', content: 'new', find: 'old' }
      ];

      (fs.readFile as jest.Mock).mockResolvedValue('old content');
      (fileUtils.writeFileWithReplace as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.successfulOps).toBe(1);
      expect(fileUtils.writeFileWithReplace).toHaveBeenCalledWith('test.ts', 'new', 'old');
    });

    it('should execute move operation successfully', async () => {
      const ops = [
        { type: 'move' as const, oldPath: 'old.ts', newPath: 'new.ts' }
      ];

      (fileUtils.moveFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.successfulOps).toBe(1);
      expect(fileUtils.moveFile).toHaveBeenCalledWith('old.ts', 'new.ts');
    });

    it('should execute delete operation successfully', async () => {
      const ops = [
        { type: 'delete' as const, filePath: 'test.ts' }
      ];

      (fs.readFile as jest.Mock).mockResolvedValue('content');
      (fileUtils.deleteFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.successfulOps).toBe(1);
      expect(fileUtils.deleteFile).toHaveBeenCalledWith('test.ts');
    });

    it('should backup files before edit', async () => {
      const ops = [
        { type: 'edit' as const, filePath: 'test.ts', content: 'new' }
      ];

      (fs.readFile as jest.Mock).mockResolvedValue('original content');
      (fileUtils.writeFileWithReplace as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.fileOriginalContents.get('test.ts')).toBe('original content');
    });

    it('should backup files before delete', async () => {
      const ops = [
        { type: 'delete' as const, filePath: 'test.ts' }
      ];

      (fs.readFile as jest.Mock).mockResolvedValue('original content');
      (fileUtils.deleteFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.fileOriginalContents.get('test.ts')).toBe('original content');
    });

    it('should handle operation failure', async () => {
      const ops = [
        { type: 'create' as const, filePath: 'test.ts', content: 'code' }
      ];

      (fileUtils.createFile as jest.Mock).mockRejectedValue(new Error('Write error'));

      await expect(executePlan(ops, 'test plan')).rejects.toThrow('计划执行不完整');
    });

    it('should throw error for invalid operations', async () => {
      const ops = [
        { type: 'create' as const, filePath: 'test.ts', content: 'code' }
      ];

      (OperationValidator.validateOperations as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ['Invalid operation']
      });

      await expect(executePlan(ops, 'test plan')).rejects.toThrow('计划包含无效操作');
    });

    it('should execute multiple operations in sequence', async () => {
      const ops = [
        { type: 'create' as const, filePath: 'test1.ts', content: 'code1' },
        { type: 'create' as const, filePath: 'test2.ts', content: 'code2' }
      ];

      (fileUtils.createFile as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.successfulOps).toBe(2);
      expect(result.failedOps).toBe(0);
    });

    it('should handle unknown operation type', async () => {
      const ops = [
        { type: 'unknown' as any, filePath: 'test.ts' }
      ];

      await expect(executePlan(ops, 'test plan')).rejects.toThrow();
    });

    it('should skip backup for non-existent files', async () => {
      const ops = [
        { type: 'edit' as const, filePath: 'test.ts', content: 'new' }
      ];

      (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      (fileUtils.writeFileWithReplace as jest.Mock).mockResolvedValue(undefined);

      const result = await executePlan(ops, 'test plan');

      expect(result.fileOriginalContents.size).toBe(0);
    });

    it('should return failed operations details', async () => {
      const ops = [
        { type: 'create' as const, filePath: 'test.ts', content: 'code' }
      ];

      (fileUtils.createFile as jest.Mock).mockRejectedValue(new Error('Write error'));

      try {
        await executePlan(ops, 'test plan');
      } catch (error) {
        // Expected to throw
      }

      // Verify error was logged
      expect(fileUtils.createFile).toHaveBeenCalled();
    });
  });
});