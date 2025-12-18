import { autoFixOperations } from '../plan-fixer';
import { streamAiResponse } from '../../utils/network';
import { parseAiResponse } from '../ai-response-parser';
import { OperationValidator } from '../operation-validator';
import * as fs from 'fs/promises';
import { FileOperation } from '../operation-schema';

jest.mock('../../utils/network');
jest.mock('../ai-response-parser');
jest.mock('../operation-validator');
jest.mock('fs/promises');
jest.mock('../../utils/cli-style');

const originalLog = console.log;

describe('Plan Fixer', () => {
  beforeAll(() => {
    console.log = jest.fn();
  });

  afterAll(() => {
    console.log = originalLog;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('autoFixOperations', () => {
    it('should fix operations successfully on first attempt', async () => {
      const failedOps = [
        { operation: { type: 'edit', filePath: 'test.ts', content: 'new', find: 'old' } as FileOperation, error: 'Not found' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new', find: 'corrected' }
      ];

      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(fixedOps);
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({ isValid: true });

      const result = await autoFixOperations(failedOps);
      expect(result).toEqual(fixedOps);
      expect(streamAiResponse).toHaveBeenCalledTimes(1);
    });

    it('should retry on validation failure', async () => {
      const failedOps = [
        { operation: { type: 'edit', filePath: 'test.ts', content: 'new' } as FileOperation, error: 'Error' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'fixed' }
      ];

      (streamAiResponse as jest.Mock)
        .mockResolvedValueOnce('First attempt')
        .mockResolvedValueOnce('Second attempt');
      (parseAiResponse as jest.Mock)
        .mockResolvedValueOnce([{ type: 'edit', filePath: 'test.ts', content: 'bad' }])
        .mockResolvedValueOnce(fixedOps);
      (OperationValidator.validateOperationsReachability as jest.Mock)
        .mockResolvedValueOnce({ isValid: false, errors: ['Still invalid'] })
        .mockResolvedValueOnce({ isValid: true });

      const result = await autoFixOperations(failedOps);
      expect(result).toEqual(fixedOps);
      expect(streamAiResponse).toHaveBeenCalledTimes(2);
    });

    it('should return null after max retries', async () => {
      const failedOps = [
        { operation: { type: 'edit', filePath: 'test.ts', content: 'new' } as FileOperation, error: 'Error' }
      ];

      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue([{ type: 'edit', filePath: 'test.ts', content: 'bad' }]);
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({ 
        isValid: false, 
        errors: ['Invalid'] 
      });

      const result = await autoFixOperations(failedOps, 2);
      expect(result).toBeNull();
      expect(streamAiResponse).toHaveBeenCalledTimes(2);
    });

    it('should handle AI returning no operations', async () => {
      const failedOps = [
        { operation: { type: 'create', filePath: 'test.ts', content: 'code' } as FileOperation, error: 'Error' }
      ];

      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue([]);

      const result = await autoFixOperations(failedOps, 1);
      expect(result).toBeNull();
    });

    it('should read file content for edit operations', async () => {
      const failedOps = [
        { operation: { type: 'edit', filePath: 'test.ts', content: 'new', find: 'old' } as FileOperation, error: 'Not found' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'new', find: 'corrected' }
      ];

      (fs.readFile as jest.Mock).mockResolvedValue('file content');
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(fixedOps);
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({ isValid: true });

      const result = await autoFixOperations(failedOps);
      expect(fs.readFile).toHaveBeenCalledWith('test.ts', 'utf-8');
      expect(result).toEqual(fixedOps);
    });

    it('should handle file read errors gracefully', async () => {
      const failedOps = [
        { operation: { type: 'edit', filePath: 'test.ts', content: 'new' } as FileOperation, error: 'Error' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'edit', filePath: 'test.ts', content: 'fixed' }
      ];

      (fs.readFile as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(fixedOps);
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({ isValid: true });

      const result = await autoFixOperations(failedOps);
      expect(result).toEqual(fixedOps);
    });

    it('should handle AI call failures', async () => {
      const failedOps = [
        { operation: { type: 'create', filePath: 'test.ts', content: 'code' } as FileOperation, error: 'Error' }
      ];

      (streamAiResponse as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await autoFixOperations(failedOps, 1);
      expect(result).toBeNull();
    });

    it('should filter non-file operations from AI response', async () => {
      const failedOps = [
        { operation: { type: 'create', filePath: 'test.ts', content: 'code' } as FileOperation, error: 'Error' }
      ];
      const aiOps = [
        { type: 'response', content: 'explanation' },
        { type: 'create', filePath: 'test.ts', content: 'fixed' }
      ];

      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(aiOps);
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({ isValid: true });

      const result = await autoFixOperations(failedOps);
      expect(result).toHaveLength(1);
      expect(result![0].type).toBe('create');
    });

    it('should handle multiple failed operations', async () => {
      const failedOps = [
        { operation: { type: 'create', filePath: 'test1.ts', content: 'code1' } as FileOperation, error: 'Error 1' },
        { operation: { type: 'edit', filePath: 'test2.ts', content: 'code2', find: 'old' } as FileOperation, error: 'Error 2' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'create', filePath: 'test1.ts', content: 'fixed1' },
        { type: 'edit', filePath: 'test2.ts', content: 'fixed2', find: 'corrected' }
      ];

      (fs.readFile as jest.Mock).mockResolvedValue('file content');
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(fixedOps);
      (OperationValidator.validateOperationsReachability as jest.Mock).mockResolvedValue({ isValid: true });

      const result = await autoFixOperations(failedOps);
      expect(result).toEqual(fixedOps);
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('should handle validation errors with retry', async () => {
      const failedOps = [
        { operation: { type: 'create', filePath: 'test.ts', content: 'code' } as FileOperation, error: 'Error' }
      ];
      const fixedOps: FileOperation[] = [
        { type: 'create', filePath: 'test.ts', content: 'fixed' }
      ];

      (streamAiResponse as jest.Mock)
        .mockResolvedValueOnce('First attempt')
        .mockResolvedValueOnce('Second attempt');
      (parseAiResponse as jest.Mock)
        .mockResolvedValueOnce([{ type: 'create', filePath: 'test.ts', content: 'bad' }])
        .mockResolvedValueOnce(fixedOps);
      (OperationValidator.validateOperationsReachability as jest.Mock)
        .mockResolvedValueOnce({ isValid: false, errors: ['Invalid'] })
        .mockResolvedValueOnce({ isValid: true });

      const result = await autoFixOperations(failedOps, 3);
      expect(result).toEqual(fixedOps);
      expect(streamAiResponse).toHaveBeenCalledTimes(2);
    });

    it('should handle parse errors', async () => {
      const failedOps = [
        { operation: { type: 'create', filePath: 'test.ts', content: 'code' } as FileOperation, error: 'Error' }
      ];

      (streamAiResponse as jest.Mock).mockRejectedValue(new Error('Parse error'));

      const result = await autoFixOperations(failedOps, 1);
      expect(result).toBeNull();
    });
  });
});