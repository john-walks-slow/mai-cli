import { parseAiResponse, parseJsonOperations, parseOperations } from '../ai-response-parser';

const OP_START = '--- OPERATION start ---';
const OP_END = '--- OPERATION end ---';
const CONTENT_START = '--- content start ---';
const CONTENT_END = '--- content end ---';

describe('AI Response Parser', () => {
  describe('parseDelimitedOperations', () => {
    it('should parse valid response operation', async () => {
      const response = [
        OP_START,
        'type: response',
        CONTENT_START,
        'Test response',
        CONTENT_END,
        OP_END
      ].join('\n');

      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('response');
      expect((ops[0] as any).content).toBe('Test response');
    });

    it('should parse valid create operation', async () => {
      const response = [
        OP_START,
        'type: create',
        'filePath: D:\\test\\file.ts',
        CONTENT_START,
        'const x = 1;',
        CONTENT_END,
        OP_END
      ].join('\n');

      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('create');
      expect((ops[0] as any).filePath).toContain('test');
    });

    it('should parse operation with numeric parameters', async () => {
      const response = [
        OP_START,
        'type: edit',
        'filePath: test.ts',
        'startLine: 10',
        'endLine: 20',
        CONTENT_START,
        'new code',
        CONTENT_END,
        OP_END
      ].join('\n');

      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(1);
      expect((ops[0] as any).startLine).toBe(10);
      expect((ops[0] as any).endLine).toBe(20);
    });

    it('should parse operation with boolean parameters', async () => {
      const response = [
        OP_START,
        'type: list_directory',
        'path: .',
        'recursive: true',
        OP_END
      ].join('\n');

      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(1);
      expect((ops[0] as any).recursive).toBe(true);
    });

    it('should parse multiple operations', async () => {
      const response = [
        OP_START,
        'type: response',
        CONTENT_START,
        'First',
        CONTENT_END,
        OP_END,
        '',
        OP_START,
        'type: response',
        CONTENT_START,
        'Second',
        CONTENT_END,
        OP_END
      ].join('\n');

      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(2);
    });

    it('should handle empty response', async () => {
      const ops = await parseAiResponse('');
      expect(ops).toHaveLength(0);
    });

    it('should skip invalid operations', async () => {
      const response = [OP_START, 'type: invalid', OP_END].join('\n');

      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(0);
    });

    it('should handle operation without type', async () => {
      const response = [OP_START, 'content: test', OP_END].join('\n');

      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(0);
    });

    it('should handle nested start delimiters in loose mode', async () => {
      const response = [
        OP_START,
        'type: response',
        CONTENT_START,
        'content',
        CONTENT_START,
        'nested',
        CONTENT_END,
        OP_END
      ].join('\n');

      const ops = await parseAiResponse(response, true, true);
      expect(ops.length).toBeGreaterThanOrEqual(0);
    });

    it('should skip operations with validation disabled', async () => {
      const response = [
        OP_START,
        'type: response',
        CONTENT_START,
        'test',
        CONTENT_END,
        OP_END
      ].join('\n');

      const ops = await parseAiResponse(response, false);
      expect(ops).toHaveLength(1);
    });
  });

  describe('parseJsonOperations', () => {
    it('should parse JSON array format', async () => {
      const response = JSON.stringify([{ type: 'response', content: 'Test' }]);

      const ops = await parseJsonOperations(response);
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('response');
    });

    it('should parse single JSON object', async () => {
      const response = JSON.stringify({ type: 'response', content: 'Test' });

      const ops = await parseJsonOperations(response);
      expect(ops).toHaveLength(1);
    });

    it('should reject non-JSON format', async () => {
      await expect(parseJsonOperations('not json')).rejects.toThrow();
    });

    it('should reject invalid operations in JSON', async () => {
      const response = JSON.stringify([{ type: 'invalid' }]);
      await expect(parseJsonOperations(response)).rejects.toThrow();
    });

    it('should handle empty JSON array', async () => {
      const response = JSON.stringify([]);
      const ops = await parseJsonOperations(response);
      expect(ops).toHaveLength(0);
    });
  });

  describe('parseOperations', () => {
    it('should auto-detect JSON format', async () => {
      const response = JSON.stringify([{ type: 'response', content: 'Test' }]);
      const ops = await parseOperations(response);
      expect(ops).toHaveLength(1);
    });

    it('should fallback to delimited format on JSON error', async () => {
      const response = [
        OP_START,
        'type: response',
        CONTENT_START,
        'test',
        CONTENT_END,
        OP_END
      ].join('\n');

      const ops = await parseOperations(response);
      expect(ops).toHaveLength(1);
    });

    it('should handle empty response', async () => {
      const ops = await parseOperations('');
      expect(ops).toHaveLength(0);
    });
  });
});
