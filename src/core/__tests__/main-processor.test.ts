import { processRequest } from '../main-processor';
import { getFileContext } from '../file-context';
import { loadHistory, getRecentHistory } from '../../commands/history';
import { getHistoryDepth, getSystemPrompt, getTemperature, getNestedConfig } from '../../config';
import { streamAiResponse } from '../../utils/network';
import { parseAiResponse } from '../ai-response-parser';
import { reviewAndExecutePlan } from '../plan-reviewer';
import { executeContextOperations } from '../context-collector';
import * as fs from 'fs/promises';

jest.mock('../file-context');
jest.mock('../../commands/history');
jest.mock('../../config');
jest.mock('../../utils/network');
jest.mock('../ai-response-parser');
jest.mock('../plan-reviewer');
jest.mock('../context-collector');
jest.mock('fs/promises');
jest.mock('../../utils/cli-style');
jest.mock('ora', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis()
  }))
}));

const originalLog = console.log;

describe('Main Processor', () => {
  beforeAll(() => {
    console.log = jest.fn();
  });

  afterAll(() => {
    console.log = originalLog;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (getHistoryDepth as jest.Mock).mockResolvedValue(0);
    (getSystemPrompt as jest.Mock).mockResolvedValue('');
    (getTemperature as jest.Mock).mockResolvedValue(0.7);
    (getNestedConfig as jest.Mock).mockResolvedValue(false);
    (getFileContext as jest.Mock).mockResolvedValue('');
    (getRecentHistory as jest.Mock).mockResolvedValue([]);
    (loadHistory as jest.Mock).mockResolvedValue([]);
  });

  describe('processRequest', () => {
    it('should handle empty prompt', async () => {
      await processRequest('', []);
      expect(streamAiResponse).not.toHaveBeenCalled();
    });

    it('should process simple response without autoContext', async () => {
      const ops = [{ type: 'response', content: 'answer' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(ops);

      await processRequest('test', []);
      expect(streamAiResponse).toHaveBeenCalled();
    });

    it('should process file operations without autoContext', async () => {
      const ops = [{ type: 'create', filePath: 'test.ts', content: 'code' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(ops);
      (reviewAndExecutePlan as jest.Mock).mockResolvedValue({ applied: true });

      await processRequest('test', []);
      expect(reviewAndExecutePlan).toHaveBeenCalled();
    });

    it('should handle multi-round information gathering with autoContext', async () => {
      (getNestedConfig as jest.Mock).mockResolvedValue(true);
      
      const contextOps = [{ type: 'read_file', path: 'test.ts' }];
      const fileOps = [{ type: 'create', filePath: 'new.ts', content: 'code' }];
      
      (streamAiResponse as jest.Mock)
        .mockResolvedValueOnce('First response')
        .mockResolvedValueOnce('Second response');
      (parseAiResponse as jest.Mock)
        .mockResolvedValueOnce(contextOps)
        .mockResolvedValueOnce(fileOps);
      (executeContextOperations as jest.Mock).mockResolvedValue('context results');
      (reviewAndExecutePlan as jest.Mock).mockResolvedValue({ applied: true });

      await processRequest('test', [], undefined, undefined, undefined, true);
      expect(executeContextOperations).toHaveBeenCalled();
      expect(reviewAndExecutePlan).toHaveBeenCalled();
    });

    it('should respect maxRounds limit', async () => {
      (getNestedConfig as jest.Mock)
        .mockImplementation((key) => {
          if (key === 'autoContext.enabled') return Promise.resolve(true);
          if (key === 'autoContext.maxRounds') return Promise.resolve(2);
          if (key === 'autoContext.maxOperations') return Promise.resolve(10);
          return Promise.resolve(false);
        });

      const contextOps = [{ type: 'read_file', path: 'test.ts' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(contextOps);
      (executeContextOperations as jest.Mock).mockResolvedValue('results');

      await processRequest('test', [], undefined, undefined, undefined, true);
      expect(streamAiResponse).toHaveBeenCalledTimes(2);
    });

    it('should limit context operations to maxOperations', async () => {
      (getNestedConfig as jest.Mock)
        .mockImplementation((key) => {
          if (key === 'autoContext.enabled') return Promise.resolve(true);
          if (key === 'autoContext.maxRounds') return Promise.resolve(2);
          if (key === 'autoContext.maxOperations') return Promise.resolve(2);
          return Promise.resolve(false);
        });

      const contextOps = [
        { type: 'read_file', path: '1.ts' },
        { type: 'read_file', path: '2.ts' },
        { type: 'read_file', path: '3.ts' }
      ];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(contextOps);
      (executeContextOperations as jest.Mock).mockResolvedValue('results');

      await processRequest('test', [], undefined, undefined, undefined, true);
      expect(executeContextOperations).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ type: 'read_file' })
      ]));
    });

    it('should handle AI call failure gracefully', async () => {
      (getNestedConfig as jest.Mock).mockResolvedValue(true);
      (streamAiResponse as jest.Mock).mockRejectedValue(new Error('Network error'));

      await processRequest('test', [], undefined, undefined, undefined, true);
      expect(console.log).toHaveBeenCalled();
    });

    it('should handle context operation failure', async () => {
      (getNestedConfig as jest.Mock).mockResolvedValue(true);
      const contextOps = [{ type: 'read_file', path: 'test.ts' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(contextOps);
      (executeContextOperations as jest.Mock).mockRejectedValue(new Error('Read error'));

      await processRequest('test', [], undefined, undefined, undefined, true);
      expect(console.log).toHaveBeenCalled();
    });

    it('should use custom system prompt', async () => {
      const customPrompt = 'Custom system prompt';
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue([{ type: 'response', content: 'answer' }]);

      await processRequest('test', [], undefined, undefined, customPrompt);
      expect(streamAiResponse).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: 'system', content: customPrompt })
        ]),
        expect.any(Object)
      );
    });

    it('should load history context', async () => {
      const historyEntry = {
        id: 1,
        prompt: 'old prompt',
        aiResponse: 'old response',
        files: ['old.ts']
      };
      (getHistoryDepth as jest.Mock).mockResolvedValue(1);
      (getRecentHistory as jest.Mock).mockResolvedValue([historyEntry]);
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue([{ type: 'response', content: 'answer' }]);

      await processRequest('test', []);
      expect(getRecentHistory).toHaveBeenCalledWith(1);
    });

    it('should handle autoApply mode', async () => {
      const ops = [{ type: 'create', filePath: 'test.ts', content: 'code' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(ops);
      (reviewAndExecutePlan as jest.Mock).mockResolvedValue({ applied: true });

      await processRequest('test', [], undefined, undefined, undefined, false, true);
      expect(reviewAndExecutePlan).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        expect.any(String),
        true
      );
    });

    it('should handle response operations without autoContext', async () => {
      const ops = [{ type: 'response', content: 'answer' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(ops);

      await processRequest('test', []);
      expect(streamAiResponse).toHaveBeenCalled();
    });

    it('should handle context operations in non-autoContext mode', async () => {
      const contextOps = [{ type: 'read_file', path: 'test.ts' }];
      const fileOps = [{ type: 'create', filePath: 'new.ts', content: 'code' }];
      
      (streamAiResponse as jest.Mock)
        .mockResolvedValueOnce('First response')
        .mockResolvedValueOnce('Second response');
      (parseAiResponse as jest.Mock)
        .mockResolvedValueOnce(contextOps)
        .mockResolvedValueOnce(fileOps);
      (executeContextOperations as jest.Mock).mockResolvedValue('context results');
      (reviewAndExecutePlan as jest.Mock).mockResolvedValue({ applied: true });

      await processRequest('test', []);
      expect(executeContextOperations).toHaveBeenCalled();
    });

    it('should handle only response operations in non-autoContext mode', async () => {
      const responseOps = [{ type: 'response', content: 'answer' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(responseOps);

      await processRequest('test', []);
      expect(streamAiResponse).toHaveBeenCalled();
    });

    it('should handle max rounds in non-autoContext mode', async () => {
      const contextOps = [{ type: 'read_file', path: 'test.ts' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(contextOps);
      (executeContextOperations as jest.Mock).mockResolvedValue('results');

      await processRequest('test', []);
      expect(streamAiResponse).toHaveBeenCalledTimes(3);
    });

    it('should handle empty operations response', async () => {
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue([]);

      await processRequest('test', []);
      expect(streamAiResponse).toHaveBeenCalled();
    });

    it('should handle context operation failure in non-autoContext', async () => {
      const contextOps = [{ type: 'read_file', path: 'test.ts' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(contextOps);
      (executeContextOperations as jest.Mock).mockRejectedValue(new Error('Read error'));

      await processRequest('test', []);
      expect(console.log).toHaveBeenCalled();
    });

    it('should handle file operations with response in non-autoContext', async () => {
      const ops = [
        { type: 'response', content: 'explanation' },
        { type: 'create', filePath: 'test.ts', content: 'code' }
      ];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(ops);
      (reviewAndExecutePlan as jest.Mock).mockResolvedValue({ applied: true });

      await processRequest('test', []);
      expect(reviewAndExecutePlan).toHaveBeenCalled();
    });

    it('should handle history with applied status', async () => {
      const historyEntry = {
        id: 1,
        prompt: 'old prompt',
        aiResponse: 'old response',
        files: ['old.ts'],
        applied: true
      };
      (getHistoryDepth as jest.Mock).mockResolvedValue(1);
      (getRecentHistory as jest.Mock).mockResolvedValue([historyEntry]);
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue([{ type: 'response', content: 'answer' }]);

      await processRequest('test', []);
      expect(getRecentHistory).toHaveBeenCalledWith(1);
    });

    it('should handle custom model and temperature', async () => {
      const ops = [{ type: 'response', content: 'answer' }];
      (streamAiResponse as jest.Mock).mockResolvedValue('AI response');
      (parseAiResponse as jest.Mock).mockResolvedValue(ops);

      await processRequest('test', [], undefined, undefined, undefined, false, false, 'custom-model', 0.5);
      expect(streamAiResponse).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ model: 'custom-model', temperature: 0.5 })
      );
    });
  });
});