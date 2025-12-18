import { ModelMessage } from 'ai';
import { getFileContext } from './file-context';
import {
  getRecentHistory,
  loadHistory,
  parseIdOrName,
  HistoryEntry,
  saveAiHistory
} from '../commands/history';
import {
  getHistoryDepth,
  getSystemPrompt,
  getTemperature
} from '../utils/config-manager';
import { CliStyle } from '../utils/cli-style';
import { prepareAutoContext } from './auto-context';
import { createUserPrompt, constructSystemPrompt } from '../constants/prompts';
import { streamAiResponse } from '../utils/network';
import { parseAiResponse } from './ai-response-parser';
import { reviewAndExecutePlan } from './plan-reviewer';
import { FileOperation, ResponseOperation } from './operation-schema';
import ora from 'ora';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export async function processRequest(
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

  const actualSystemPrompt = await resolveSystemPrompt(systemPrompt);
  const actualTemperature =
    temperature !== undefined ? temperature : await getTemperature();

  if (autoApply) {
    console.log(CliStyle.info('启用自动应用模式，无需用户确认。'));
  }

  const { messages } = await buildContext(
    userPrompt,
    files,
    historyIds,
    historyDepth,
    autoContext
  );

  const fullMessages: ModelMessage[] = [
    ...(actualSystemPrompt
      ? [{ role: 'system', content: actualSystemPrompt }]
      : []),
    ...messages
  ] as ModelMessage[];

  const aiResponse = await callAi(fullMessages, model, actualTemperature);
  await saveDebugInfo(aiResponse, JSON.stringify(fullMessages, null, 2));
  await handleResponse(aiResponse, userPrompt, autoApply || false, files);
}

async function resolveSystemPrompt(systemPrompt?: string): Promise<string> {
  if (systemPrompt !== undefined) {
    if (systemPrompt) {
      console.log(
        CliStyle.info(
          `使用指定的系统提示词（长度: ${systemPrompt.length} 字符）。`
        )
      );
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

async function buildContext(
  userPrompt: string,
  files: string[],
  historyIds?: string[],
  historyDepth?: number,
  autoContext?: boolean
): Promise<{ messages: ModelMessage[] }> {
  let historyMessages: ModelMessage[] = [];
  let fileContext = '';
  let entries: HistoryEntry[] = [];
  let additionalFiles: string[] = [];

  if (autoContext) {
    console.log(CliStyle.info('启用自动上下文准备...'));
    additionalFiles = await prepareAutoContext(userPrompt);
  }

  if (historyIds && historyIds.length > 0) {
    console.log(
      CliStyle.info(`正在加载多个历史上下文: ${historyIds.join(', ')}`)
    );
    const history = await loadHistory();
    for (const idOrName of historyIds) {
      const result = parseIdOrName(idOrName, history);
      entries.push(result.entry!);
      if (result.entry!.files && result.entry!.files.length > 0) {
        files.push(...result.entry!.files);
      }
    }
  } else {
    let effectiveDepth =
      historyDepth !== undefined ? historyDepth : await getHistoryDepth();
    if (effectiveDepth > 0) {
      console.log(CliStyle.info(`正在加载最近 ${effectiveDepth} 条历史上下文`));
      entries = await getRecentHistory(effectiveDepth);
      entries.forEach((entry) => {
        if (entry.files && entry.files.length > 0) {
          files.push(...entry.files);
        }
      });
    }
  }

  files = [...new Set([...files, ...additionalFiles])];

  if (files.length > 0) {
    console.log(CliStyle.info('正在读取文件并为AI准备上下文...'));
    fileContext = await getFileContext(files);
  }

  if (entries.length > 0) {
    const reversedEntries = entries.slice().reverse();
    for (const entry of reversedEntries) {
      historyMessages.push({ role: 'user', content: entry.prompt });
      historyMessages.push({
        role: 'assistant',
        content: entry.aiResponse || ''
      });
      if (entry.applied !== undefined) {
        const choice = entry.applied ? '应用' : '放弃';
        historyMessages.push({
          role: 'user',
          content: `用户选择了${choice}该计划。`
        });
      }
    }
    console.log(CliStyle.info(`已将 ${entries.length} 条历史添加到对话历史中`));
  }

  const userMessage = createUserPrompt(userPrompt);
  const messages: ModelMessage[] = [
    ...historyMessages,
    { role: 'user', content: userMessage },
    ...(fileContext ? [{ role: 'user', content: fileContext }] : [])
  ] as ModelMessage[];

  return { messages };
}

async function callAi(
  messages: ModelMessage[],
  model?: string,
  temperature?: number
): Promise<string> {
  const aiSpinner = ora({
    text: 'AI思考中...',
    spinner: {
      interval: 80,
      frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    }
  }).start();

  const startTime = Date.now();
  let receivedChars = 0;

  const updateSpinner = () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    aiSpinner.text =
      receivedChars > 0
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

async function handleResponse(
  aiResponse: string,
  userPrompt: string,
  autoApply: boolean,
  files: string[]
): Promise<void> {
  if (!aiResponse?.trim()) {
    await saveAiHistory(
      userPrompt,
      aiResponse,
      [],
      new Map(),
      '空AI响应',
      files
    );
    console.log(CliStyle.warning('AI响应为空，无操作可执行。'));
    return;
  }

  console.log(CliStyle.process('\n--- 解析AI响应 ---'));
  const operations = await parseAiResponse(aiResponse);

  if (operations.length === 0) {
    await saveAiHistory(
      userPrompt,
      aiResponse,
      [],
      new Map(),
      '仅包含AI响应',
      files
    );
    console.log(CliStyle.warning('AI未提出任何结构化操作。'));
    console.log(CliStyle.info('\n--- 原始AI响应 ---'));
    console.log(CliStyle.markdown(aiResponse.trim()));
    return;
  }

  console.log(CliStyle.success(`成功解析 ${operations.length} 个操作。`));

  const responseOps = operations.filter(
    (op): op is ResponseOperation => op.type === 'response'
  );
  const fileOps = operations.filter(
    (op): op is FileOperation => op.type !== 'response'
  );

  const filesToBackup: Set<string> = new Set();
  for (const op of fileOps) {
    if (op.type === 'edit' || op.type === 'delete') {
      filesToBackup.add(op.filePath);
    }
  }

  const fileOriginalContents = new Map<string, string>();
  for (const filePath of filesToBackup) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      fileOriginalContents.set(filePath, content);
    } catch {}
  }

  if (responseOps.length > 0) {
    console.log(CliStyle.success('\n--- AI说明 ---'));
    responseOps.forEach((op) => {
      if (op.comment) {
        console.log(CliStyle.comment(`说明: ${op.comment}`));
      }
      console.log(CliStyle.markdown(op.content));
      console.log();
    });
    console.log(CliStyle.success('--- 说明结束 ---\n'));
  }

  if (fileOps.length > 0) {
    const { applied } = await reviewAndExecutePlan(
      fileOps,
      '',
      userPrompt,
      autoApply
    );
    if (applied) {
      await saveAiHistory(
        userPrompt,
        aiResponse,
        operations,
        fileOriginalContents,
        `执行成功: ${fileOps.length} 个文件操作`,
        files
      );
    }
  } else {
    await saveAiHistory(
      userPrompt,
      aiResponse,
      operations,
      fileOriginalContents,
      '仅包含AI响应，无文件操作',
      files
    );
    console.log(CliStyle.success('AI操作完成（仅包含说明文本）。'));
  }
}

async function saveDebugInfo(
  aiResponse: string,
  messagesJson: string
): Promise<void> {
  try {
    const tempDir = os.tmpdir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const tempFilePath = path.join(
      tempDir,
      `mai-ai-response-${timestamp}-messages.md`
    );

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
    console.log(
      CliStyle.warning(`无法保存AI响应到临时文件: ${(error as Error).message}`)
    );
  }
}
