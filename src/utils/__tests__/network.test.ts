import { streamAiResponse, getAiResponse } from '../network';
import { streamText } from 'ai';
import * as config from '../../config';

jest.mock('ai');
jest.mock('../../config');
jest.mock('../cli-style');
jest.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: jest.fn(() => jest.fn())
}));

describe('network', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (config.getCurrentModel as jest.Mock).mockResolvedValue('openai/gpt-4');
    (config.getCurrentModelName as jest.Mock).mockResolvedValue('gpt-4');
    (config.parseModel as jest.Mock).mockResolvedValue({ provider: 'openai', model: 'gpt-4' });
    (config.getApiEndpoint as jest.Mock).mockResolvedValue('https://api.openai.com/v1');
    (config.getApiKey as jest.Mock).mockResolvedValue('test-key');
  });

  describe('streamAiResponse', () => {
    it('应该流式返回 AI 响应', async () => {
      const mockStream = {
        textStream: (async function* () {
          yield 'Hello';
          yield ' ';
          yield 'World';
        })()
      };
      (streamText as jest.Mock).mockReturnValue(mockStream);

      const result = await streamAiResponse([{ role: 'user', content: 'test' }]);
      
      expect(result).toBe('Hello World');
    });

    it('应该调用 onChunk 回调', async () => {
      const mockStream = {
        textStream: (async function* () {
          yield 'test';
        })()
      };
      (streamText as jest.Mock).mockReturnValue(mockStream);
      
      const onChunk = jest.fn();
      await streamAiResponse([{ role: 'user', content: 'test' }], { onChunk });
      
      expect(onChunk).toHaveBeenCalled();
    });

    it('应该在模型名称缺失时抛出错误', async () => {
      (config.getCurrentModelName as jest.Mock).mockResolvedValue(null);
      
      await expect(
        streamAiResponse([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('无法获取模型名称');
    });

    it('应该在模型格式无效时抛出错误', async () => {
      (config.parseModel as jest.Mock).mockResolvedValue(null);
      
      await expect(
        streamAiResponse([{ role: 'user', content: 'test' }])
      ).rejects.toThrow('无效的模型格式');
    });
  });

  describe('getAiResponse', () => {
    it('应该返回 AI 响应', async () => {
      const mockStream = {
        textStream: (async function* () {
          yield 'response';
        })()
      };
      (streamText as jest.Mock).mockReturnValue(mockStream);

      const result = await getAiResponse([{ role: 'user', content: 'test' }]);
      
      expect(result).toBe('response');
    });

    it('应该在失败时重试', async () => {
      (streamText as jest.Mock)
        .mockReturnValueOnce({
          textStream: (async function* () {
            throw new Error('Network error');
          })()
        })
        .mockReturnValueOnce({
          textStream: (async function* () {
            yield 'success';
          })()
        });

      const result = await getAiResponse([{ role: 'user', content: 'test' }], 2);
      
      expect(result).toBe('success');
    });

    it('应该在所有重试失败后抛出错误', async () => {
      (streamText as jest.Mock).mockReturnValue({
        textStream: (async function* () {
          throw new Error('Network error');
        })()
      });

      await expect(
        getAiResponse([{ role: 'user', content: 'test' }], 2)
      ).rejects.toThrow();
    });
  });
});