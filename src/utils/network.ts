import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, ModelMessage, streamText } from 'ai';
import * as fs from 'fs/promises';
import { CliStyle } from './cli-style';
import {
  getApiEndpoint,
  getApiKey,
  getCurrentModel,
  getCurrentModelName,
  parseModel
} from '../config';
import { env } from 'process';
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';

// Corporate proxy uses CA not in undici's certificate store
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const dispatcher = new EnvHttpProxyAgent();
setGlobalDispatcher(dispatcher);

/**
 * 延迟执行指定毫秒数。
 * @param ms - 等待的毫秒数。
 */
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 流式生成 AI 响应的文本。
 * @param messages - 发送给 AI 的消息数组。
 * @param options - 可选的生成选项。
 * @returns 生成的文本流。
 * @throws {Error} 如果 AI 请求失败。
 */
export async function streamAiResponse(
  messages: ModelMessage[],
  options?: {
    model?: string;
    temperature?: number;
    onChunk?: (delta: string, accumulatedResponse: string) => void;
  }
): Promise<string> {
  const {
    model = await getCurrentModel(),
    temperature,
    onChunk
  } = options || {};

  const modelName = await getCurrentModelName();
  if (!modelName) {
    throw new Error('无法获取模型名称');
  }

  // 解析提供商信息
  const parsedModel = await parseModel(model);
  if (!parsedModel) {
    throw new Error(`无效的模型格式: ${model}`);
  }

  // 获取 API 端点和密钥
  const apiEndpoint = await getApiEndpoint(model);
  const apiKey = await getApiKey(model);
  CliStyle.printDebug('--- AI 流式请求配置 ---');
  CliStyle.printDebugContent(
    JSON.stringify(
      {
        provider: parsedModel.provider,
        model: modelName,
        endpoint: apiEndpoint,
        messages: messages.length
      },
      null,
      2
    )
  );
  CliStyle.printDebug('----------------------------');

  // 根据提供商创建对应的 AI SDK 客户端
  const client = createOpenAICompatible({
    name: parsedModel.provider,
    baseURL: apiEndpoint,
    apiKey: apiKey
  });

  // 使用流式生成文本
  const result = streamText({
    model: client(modelName),
    messages: messages,
    temperature: temperature !== undefined ? temperature : 0.7
  });

  // 初始化响应缓冲区
  let fullResponse = '';

  CliStyle.printDebug('--- 开始接收流式响应 ---');

  // 逐个处理文本块
  for await (const delta of result.textStream) {
    // 累积响应内容
    fullResponse += delta;

    // 触发增量回调
    if (onChunk) {
      onChunk(delta, fullResponse);
    }
  }

  CliStyle.printDebug('--- AI 流式响应结束 ---');
  CliStyle.printDebugContent(fullResponse.trim());
  CliStyle.printDebug('----------------------------');

  return fullResponse.trim();
}

/**
 * 从配置的AI模型获取响应，带有重试逻辑。
 * @param messages - 发送给AI的消息数组。
 * @param retries - 失败时重试次数。
 * @param model - 可选的模型名称。
 * @param temperature - 可选的temperature参数。
 * @param streamCallback - 可选的流式回调函数，用于处理实时响应。
 * @returns AI响应的字符串内容。
 * @throws {Error} 如果AI请求失败。
 */
export async function getAiResponse(
  messages: ModelMessage[],
  retries = 3,
  model?: string,
  temperature?: number,
  streamCallback?: (chunk: string) => void
): Promise<string> {
  const modelName = model || (await getCurrentModelName()); // Use specified model or fallback to current

  CliStyle.printDebug('--- 原始AI请求负载 ---');
  CliStyle.printDebugContent(
    JSON.stringify(
      {
        model: modelName,
        messages: messages.length,
        temperature: temperature
      },
      null,
      2
    )
  );
  CliStyle.printDebug('-------------------------------------');

  for (let i = 0; i < retries; i++) {
    try {
      const response = await streamAiResponse(messages, {
        model,
        temperature,
        onChunk: streamCallback
      });

      if (response && response.trim()) {
        return response.trim();
      } else {
        throw new Error('无效的AI响应格式。');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(
        `第 ${i + 1} 次尝试（共 ${retries} 次）失败。`,
        errorMessage
      );
      if (i === retries - 1) {
        console.error('最后一次尝试失败。中止。');
        throw error;
      }
      const backoffTime = 2 ** i;
      console.warn(`将在 ${backoffTime} 秒后重试...`);
      await delay(1000 * backoffTime);
    }
  }

  throw new Error('AI请求在所有重试后失败。');
}
