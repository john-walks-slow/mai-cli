import { ModelMessage } from 'ai';
import { ContextBuilder } from './context-builder';
import { ResponseHandler } from './response-handler';
import { streamAiResponse } from '../utils/network';
import { getSystemPrompt, getTemperature } from '../utils/config-manager';
import { constructSystemPrompt } from '../constants/prompts';
import { CliStyle } from '../utils/cli-style';
import ora from 'ora';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export class RequestOrchestrator {
  constructor(
    private contextBuilder: ContextBuilder,
    private responseHandler: ResponseHandler
  ) {}

  async process(
    userPrompt: string,
    files: string[],
    historyIds?: string[],
    historyDepth?: number,
    systemPrompt?: string,
    autoContext?: boolean,
    autoApply?: boolean,
    model?: string,
    temperature?: number
  ): Promise<void> {
    if (!userPrompt?.trim()) {
      console.log(CliStyle.warning('用户请求为空，退出。'));
      return;
    }

    const actualSystemPrompt = await this.resolveSystemPrompt(systemPrompt);
    const actualTemperature = temperature !== undefined ? temperature : await getTemperature();

    if (autoApply) {
      console.log(CliStyle.info('启用自动应用模式，无需用户确认。'));
    }

    const { messages, fileContext } = await this.contextBuilder.build(
      userPrompt,
      files,
      historyIds,
      historyDepth,
      autoContext
    );

    const fullMessages: ModelMessage[] = [
      ...(actualSystemPrompt ? [{ role: 'system', content: actualSystemPrompt }] : []),
      ...messages
    ] as ModelMessage[];

    const aiResponse = await this.callAi(fullMessages, model, actualTemperature);
    await this.saveDebugInfo(aiResponse, JSON.stringify(fullMessages, null, 2));
    await this.responseHandler.handle(aiResponse, userPrompt, autoApply || false, files);
  }

  private async resolveSystemPrompt(systemPrompt?: string): Promise<string> {
    if (systemPrompt !== undefined) {
      if (systemPrompt) {
        console.log(CliStyle.info(`使用指定的系统提示词（长度: ${systemPrompt.length} 字符）。`));
      } else {
        console.log(CliStyle.info('使用空系统提示词。'));
      }
      return systemPrompt;
    }

    const configSystemPrompt = await getSystemPrompt();
    if (configSystemPrompt) {
      console.log(CliStyle.info('使用配置文件中的自定义系统提示词。'));
      return configSystemPrompt;
    }

    return constructSystemPrompt();
  }

  private async callAi(messages: ModelMessage[], model?: string, temperature?: number): Promise<string> {
    const aiSpinner = ora({
      text: 'AI思考中...',
      spinner: { interval: 80, frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] }
    }).start();

    const startTime = Date.now();
    let receivedChars = 0;

    const updateSpinner = () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      aiSpinner.text = receivedChars > 0
        ? `AI流式响应中... (${elapsed}s, ${receivedChars} Received)`
        : `AI思考中... (${elapsed}s)`;
    };

    const timer = setInterval(updateSpinner, 1000);

    try {
      const response = await streamAiResponse(messages, {
        model,
        temperature,
        onChunk: (chunk: string, fullResponse: string) => {
          receivedChars = fullResponse.length;
          updateSpinner();
        }
      });

      clearInterval(timer);
      const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
      aiSpinner.succeed(`AI响应成功 (${totalElapsed}s, ${receivedChars} Total)`);
      return response;
    } catch (error) {
      clearInterval(timer);
      aiSpinner.fail('AI响应获取失败');
      throw error;
    }
  }

  private async saveDebugInfo(aiResponse: string, messagesJson: string): Promise<void> {
    try {
      const tempDir = os.tmpdir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const tempFilePath = path.join(tempDir, `mai-ai-response-${timestamp}-messages.md`);

      const content = [
        '--- AI Response Debug Info ---',
        `Timestamp: ${new Date().toISOString()}`,
        'Messages JSON:',
        '',
        messagesJson,
        '',
        `Response Length: ${aiResponse.length}`,
        '--- Raw AI Response ---',
        '',
        aiResponse,
        '',
        '--- End of Response ---'
      ].join('\n');

      await fs.writeFile(tempFilePath, content, 'utf-8');
      console.log(CliStyle.muted(`AI响应已保存: ${tempFilePath}`));
    } catch (error) {
      console.log(CliStyle.warning(`无法保存AI响应到临时文件: ${(error as Error).message}`));
    }
  }
}