import { reviewAndExecutePlan, displayPlan } from '../plan-reviewer';
import { executePlan } from '../plan-executor';
import { OperationValidator } from '../operation-validator';
import { showDiffInVsCode } from '../../utils/editor-utils';
import { autoFixOperations } from '../plan-fixer';
import inquirer from 'inquirer';
import * as fs from 'fs/promises';
import { FileOperation } from '../operation-schema';

jest.mock('../plan-executor');
jest.mock('../operation-validator');
jest.mock('../../utils/editor-utils');
jest.mock('../plan-fixer');
jest.mock('inquirer');
jest.mock('fs/promises');
jest.mock('../../utils/cli-style');

const originalLog = console.log;
const originalError = console.error;

describe('Plan Reviewer', () => {
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
    (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({ isValid: true });
  });

  describe('displayPlan', () => {
    it('should display empty plan', async () => {
      await displayPlan([]);
      expect(console.log).toHaveBeenCalled();
    });

    it('should display valid operations', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      await displayPlan(ops);
      expect(OperationValidator.validateOperations).toHaveBeenCalledWith(ops);
    });

    it('should handle invalid operations', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (OperationValidator.validateOperations as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ['Invalid operation']
      });
      await displayPlan(ops);
      expect(console.log).toHaveBeenCalled();
    });

    it('should display reachability warnings', async () => {
      const ops: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new' }
      ];
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({
        isValid: false,
        errors: ['File not found']
      });
      await displayPlan(ops);
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('reviewAndExecutePlan', () => {
    it('should return false for empty operations', async () => {
      const result = await reviewAndExecutePlan([], '', 'test');
      expect(result.applied).toBe(false);
    });

    it('should auto-apply when autoApply is true', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (executePlan as jest.Mock).mockResolvedValue({
        successfulOps: 1,
        failedOps: 0,
        executionResults: [],
        fileOriginalContents: new Map()
      });

      const result = await reviewAndExecutePlan(ops, '', 'test', true);
      expect(result.applied).toBe(true);
      expect(executePlan).toHaveBeenCalled();
    });

    it('should throw error when auto-apply fails validation', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (OperationValidator.validateOperations as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ['Invalid']
      });

      await expect(reviewAndExecutePlan(ops, '', 'test', true)).rejects.toThrow();
    });

    it('should throw error when auto-apply fails reachability', async () => {
      const ops: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new' }
      ];
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({
        isValid: false,
        errors: ['File not found']
      });

      await expect(reviewAndExecutePlan(ops, '', 'test', true)).rejects.toThrow();
    });

    it('should handle user choosing to apply', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ choice: 'apply' });
      (executePlan as jest.Mock).mockResolvedValue({
        successfulOps: 1,
        failedOps: 0,
        executionResults: [],
        fileOriginalContents: new Map()
      });

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(true);
    });

    it('should handle user choosing to cancel', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (inquirer.prompt as unknown as jest.Mock).mockResolvedValue({ choice: 'cancel' });

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle user choosing to review', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'review' })
        .mockResolvedValueOnce({ choice: 'cancel' });
      (showDiffInVsCode as jest.Mock).mockResolvedValue(null);

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(showDiffInVsCode).toHaveBeenCalled();
    });

    it('should handle user choosing review', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'old' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'review' })
        .mockResolvedValueOnce({ choice: 'cancel' });
      (showDiffInVsCode as jest.Mock).mockResolvedValue(null);

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle edit operation review', async () => {
      const ops: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new', find: 'old' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'review' })
        .mockResolvedValueOnce({ choice: 'cancel' });
      (fs.readFile as jest.Mock).mockResolvedValue('old content');
      (showDiffInVsCode as jest.Mock).mockResolvedValue(null);

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(fs.readFile).toHaveBeenCalled();
    });

    it('should handle export choice', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'export' })
        .mockResolvedValueOnce({ fileName: 'plan.json' })
        .mockResolvedValueOnce({ choice: 'cancel' });
      (fs.writeFile as jest.Mock).mockResolvedValue(undefined);

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle validation failure with force apply', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'apply' })
        .mockResolvedValueOnce({ forceApply: false });
      (OperationValidator.validateOperations as jest.Mock).mockReturnValue({
        isValid: false,
        errors: ['Invalid']
      });

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle reachability failure with force apply declined', async () => {
      const ops: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'apply' })
        .mockResolvedValueOnce({ tryAutoFix: false })
        .mockResolvedValueOnce({ forceApply: false });
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({
        isValid: false,
        errors: ['File not found']
      });

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle execution failure with retry', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'apply' })
        .mockResolvedValueOnce({ tryFix: false });
      (executePlan as jest.Mock).mockResolvedValue({
        successfulOps: 0,
        failedOps: 1,
        executionResults: [],
        fileOriginalContents: new Map(),
        failedOperations: [{ operation: ops[0], error: 'Failed' }]
      });

      await expect(reviewAndExecutePlan(ops, '', 'test', false)).rejects.toThrow();
    });

    it('should handle edit operation in review', async () => {
      const ops: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new', find: 'old' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'review' })
        .mockResolvedValueOnce({ choice: 'apply' });
      (fs.readFile as jest.Mock).mockResolvedValue('old content');
      (showDiffInVsCode as jest.Mock).mockResolvedValue('edited');
      (executePlan as jest.Mock).mockResolvedValue({
        successfulOps: 1,
        failedOps: 0,
        executionResults: [],
        fileOriginalContents: new Map()
      });

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(true);
    });

    it('should handle review continuing to apply', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'review' })
        .mockResolvedValueOnce({ choice: 'apply' });
      (showDiffInVsCode as jest.Mock).mockResolvedValue(null);
      (executePlan as jest.Mock).mockResolvedValue({
        successfulOps: 1,
        failedOps: 0,
        executionResults: [],
        fileOriginalContents: new Map()
      });

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(true);
    });

    it('should handle auto-fix success', async () => {
      const ops: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'fixed', find: 'old' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'apply' })
        .mockResolvedValueOnce({ tryAutoFix: true })
        .mockResolvedValueOnce({ choice: 'cancel' });
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({
        isValid: false,
        errors: ['File not found']
      });
      (autoFixOperations as jest.Mock).mockResolvedValue(fixedOps);

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle execution with failed operations and auto-fix', async () => {
      const ops: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'fixed' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'apply' })
        .mockResolvedValueOnce({ tryFix: true })
        .mockResolvedValueOnce({ choice: 'cancel' });
      (executePlan as jest.Mock).mockResolvedValue({
        successfulOps: 0,
        failedOps: 1,
        executionResults: [],
        fileOriginalContents: new Map(),
        failedOperations: [{ operation: ops[0], error: 'Failed' }]
      });
      (autoFixOperations as jest.Mock).mockResolvedValue(fixedOps);

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle empty operations in apply', async () => {
      const ops: FileOperation[] = [];
      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(false);
    });

    it('should handle move and delete operations in review', async () => {
      const ops: FileOperation[] = [
        { type: 'move', oldPath: 'old.ts', newPath: 'new.ts' },
        { type: 'delete', filePath: 'test.ts' }
      ];
      (inquirer.prompt as unknown as jest.Mock)
        .mockResolvedValueOnce({ choice: 'review' })
        .mockResolvedValueOnce({ choice: 'apply' });
      (executePlan as jest.Mock).mockResolvedValue({
        successfulOps: 2,
        failedOps: 0,
        executionResults: [],
        fileOriginalContents: new Map()
      });

      const result = await reviewAndExecutePlan(ops, '', 'test', false);
      expect(result.applied).toBe(true);
    });
  });
});