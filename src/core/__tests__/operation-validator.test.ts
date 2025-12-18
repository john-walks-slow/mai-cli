import { OperationValidator } from '../operation-validator';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

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

  describe('validateOperationsReachability', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should validate create when file does not exist', async () => {
      (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
      
      const ops = [{ type: 'create' as const, filePath: 'new.ts', content: '' }];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(true);
    });

    it('should reject create when file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      
      const ops = [{ type: 'create' as const, filePath: 'exists.ts', content: '' }];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(false);
    });

    it('should validate delete when file exists', async () => {
      (fs.access as jest.Mock).mockResolvedValue(undefined);
      
      const ops = [{ type: 'delete' as const, filePath: 'exists.ts' }];
      const result = await OperationValidator.validateOperationsReachability(ops);
      expect(result.isValid).toBe(true);
    });
  });
});