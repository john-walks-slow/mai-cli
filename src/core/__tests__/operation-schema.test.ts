import { validateOperation, validateOperations } from '../operation-schema';

describe('Operation Schema', () => {
  describe('validateOperation', () => {
    it('should validate response operation', () => {
      const op = { type: 'response', content: 'Test' };
      const result = validateOperation(op);
      expect(result.isValid).toBe(true);
    });

    it('should validate create operation with all fields', () => {
      const op = {
        type: 'create',
        filePath: 'test.ts',
        content: 'code',
        comment: 'Create file'
      };
      const result = validateOperation(op);
      expect(result.isValid).toBe(true);
    });

    it('should validate edit operation', () => {
      const op = {
        type: 'edit',
        filePath: 'test.ts',
        content: 'new code',
        find: 'old code'
      };
      const result = validateOperation(op);
      expect(result.isValid).toBe(true);
    });

    it('should validate move operation', () => {
      const op = {
        type: 'move',
        oldPath: 'old.ts',
        newPath: 'new.ts'
      };
      const result = validateOperation(op);
      expect(result.isValid).toBe(true);
    });

    it('should validate delete operation', () => {
      const op = { type: 'delete', filePath: 'test.ts' };
      const result = validateOperation(op);
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid type', () => {
      const op = { type: 'invalid', content: 'Test' };
      const result = validateOperation(op);
      expect(result.isValid).toBe(false);
    });

    it('should reject missing required fields', () => {
      const op = { type: 'create' };
      const result = validateOperation(op);
      expect(result.isValid).toBe(false);
    });
  });

  describe('validateOperations', () => {
    it('should validate array of operations', () => {
      const ops = [
        { type: 'response', content: 'Test' },
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      const result = validateOperations(ops);
      expect(result.isValid).toBe(true);
    });

    it('should reject if any operation is invalid', () => {
      const ops = [{ type: 'response', content: 'Test' }, { type: 'create' }];
      const result = validateOperations(ops);
      expect(result.isValid).toBe(false);
    });

    it('should reject non-array input', () => {
      const result = validateOperations({} as any);
      expect(result.isValid).toBe(false);
    });
  });
});
