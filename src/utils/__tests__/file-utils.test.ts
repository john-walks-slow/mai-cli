import { replaceInFile, computeFindMatchCount } from '../file-utils';

describe('File Utils', () => {
  describe('replaceInFile', () => {
    it('should replace content when find matches once', () => {
      const original = 'Hello World\nTest Line\nEnd';
      const result = replaceInFile(original, 'New Line', 'Test Line');
      expect(result).toBe('Hello World\nNew Line\nEnd');
    });

    it('should throw when find has no matches', () => {
      const original = 'Hello World';
      expect(() => replaceInFile(original, 'New', 'NotFound')).toThrow('未找到匹配项');
    });

    it('should throw when find has multiple matches', () => {
      const original = 'Test\nTest\nTest';
      expect(() => replaceInFile(original, 'New', 'Test')).toThrow('找到多个匹配项');
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
  });
});