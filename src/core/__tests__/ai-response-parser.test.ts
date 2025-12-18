import { parseAiResponse } from '../ai-response-parser';

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
      const response = [
        OP_START,
        'type: invalid',
        OP_END
      ].join('\n');
      
      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(0);
    });
  });

  describe('parseJsonOperations', () => {
    it('should parse JSON array format', async () => {
      const response = JSON.stringify([
        { type: 'response', content: 'Test' }
      ]);
      
      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(1);
      expect(ops[0].type).toBe('response');
    });

    it('should parse single JSON object', async () => {
      const response = JSON.stringify({ type: 'response', content: 'Test' });
      
      const ops = await parseAiResponse(response);
      expect(ops).toHaveLength(1);
    });
  });
});