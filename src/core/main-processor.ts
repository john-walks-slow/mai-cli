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
  getTemperature,
  getNestedConfig
} from '../config';
import { CliStyle } from '../utils/cli-style';
import { createUserPrompt, constructSystemPrompt } from '../constants/prompts';
import { streamAiResponse } from '../utils/network';
import { parseAiResponse } from './ai-response-parser';
import { reviewAndExecutePlan } from './plan-reviewer';
import {
  FileOperation,
  ResponseOperation,
  ContextOperation,
  AiOperation,
  isContextOperation,
  isFileOperation
} from './operation-schema';
import { executeContextOperations } from './context-collector';
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
    historyDepth
  );

  const fullMessages: ModelMessage[] = [
    ...(actualSystemPrompt
      ? [{ role: 'system', content: actualSystemPrompt }]
      : []),
    ...messages
  ] as ModelMessage[];

  // 检查是否启用自动上下文
  const autoContextEnabled =
    autoContext ?? (await getNestedConfig('autoContext.enabled'));

  if (autoContextEnabled) {
    await processWithInformationGathering(
      fullMessages,
      userPrompt,
      autoApply || false,
      files,
      model,
      actualTemperature
    );
  } else {
    await processWithoutAutoContext(
      fullMessages,
      userPrompt,
      autoApply || false,
      files,
      model,
      actualTemperature
    );
  }
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
  historyDepth?: number
): Promise<{ messages: ModelMessage[] }> {
  let historyMessages: ModelMessage[] = [];
  let fileContext = '';
  let entries: HistoryEntry[] = [];

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

async function processWithInformationGathering(
  initialMessages: ModelMessage[],
  userPrompt: string,
  autoApply: boolean,
  files: string[],
  model?: string,
  temperature?: number
): Promise<void> {
  const maxRounds = (await getNestedConfig('autoContext.maxRounds')) || 2;
  const maxOperations =
    (await getNestedConfig('autoContext.maxOperations')) || 10;

  let messages = [...initialMessages];
  let round = 0;
  let allResponses: string[] = [];

  while (round < maxRounds) {
    round++;
    console.log(CliStyle.info(`\n=== 信息收集轮次 ${round}/${maxRounds} ===`));

    let aiResponse: string;
    try {
      aiResponse = await callAi(messages, model, temperature);
      allResponses.push(aiResponse);
    } catch (error) {
      console.log(CliStyle.error(`AI 调用失败: ${(error as Error).message}`));
      console.log(CliStyle.warning('降级到直接处理模式'));
      return;
    }

    const operations = await parseAiResponse(aiResponse);

    const infoOps = operations.filter(isContextOperation);
    const fileOps = operations.filter(isFileOperation);

    if (infoOps.length > 0) {
      if (infoOps.length > maxOperations) {
        console.log(
          CliStyle.warning(`信息收集操作过多，只执行前 ${maxOperations} 个`)
        );
        infoOps.splice(maxOperations);
      }

      console.log(CliStyle.info(`执行 ${infoOps.length} 个信息收集操作...`));

      try {
        const results = await executeContextOperations(infoOps);

        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({
          role: 'user',
          content: `信息收集结果:\n${results}\n\n请基于以上信息继续完成任务。`
        });
        continue;
      } catch (error) {
        console.log(
          CliStyle.warning(`信息收集失败: ${(error as Error).message}`)
        );
        console.log(CliStyle.info('继续使用已有信息处理'));
      }
    }

    if (fileOps.length > 0 || operations.some((op) => op.type === 'response')) {
      await saveDebugInfo(aiResponse, JSON.stringify(messages, null, 2));
      await handleFinalResponse(
        aiResponse,
        userPrompt,
        autoApply,
        files,
        operations,
        allResponses
      );
      return;
    }

    console.log(CliStyle.warning('AI 未提出任何操作，结束流程。'));
    return;
  }

  console.log(CliStyle.warning(`达到最大轮次 ${maxRounds}，结束信息收集。`));
  const lastResponse = allResponses[allResponses.length - 1];
  if (lastResponse) {
    const operations = await parseAiResponse(lastResponse);
    await handleFinalResponse(
      lastResponse,
      userPrompt,
      autoApply,
      files,
      operations,
      allResponses
    );
  }
}

async function processWithoutAutoContext(
  initialMessages: ModelMessage[],
  userPrompt: string,
  autoApply: boolean,
  files: string[],
  model?: string,
  temperature?: number
): Promise<void> {
  const maxRounds = 3; // 最多3轮信息收集
  let messages = [...initialMessages];
  let round = 0;
  let allResponses: string[] = [];

  while (round < maxRounds) {
    round++;
    
    let aiResponse: string;
    try {
      aiResponse = await callAi(messages, model, temperature);
      allResponses.push(aiResponse);
    } catch (error) {
      console.log(CliStyle.error(`AI 调用失败: ${(error as Error).message}`));
      return;
    }

    const operations = await parseAiResponse(aiResponse);
    
    if (operations.length === 0) {
      console.log(CliStyle.warning('AI未提出任何结构化操作。'));
      console.log(CliStyle.info('\n--- 原始AI响应 ---'));
      console.log(CliStyle.markdown(aiResponse.trim()));
      return;
    }

    const contextOps = operations.filter(isContextOperation);
    const fileOps = operations.filter(isFileOperation);
    const responseOps = operations.filter((op): op is ResponseOperation => op.type === 'response');

    // 显示AI说明
    if (responseOps.length > 0) {
      console.log(CliStyle.success('\n--- AI说明 ---'));
      responseOps.forEach((op) => {
        if (op.comment) console.log(CliStyle.comment(`说明: ${op.comment}`));
        console.log(CliStyle.markdown(op.content));
        console.log();
      });
      console.log(CliStyle.success('--- 说明结束 ---\n'));
    }

    // 如果有信息收集操作,执行并继续循环
    if (contextOps.length > 0) {
      console.log(CliStyle.info(`\n执行 ${contextOps.length} 个信息收集操作...`));
      try {
        const results = await executeContextOperations(contextOps);
        messages.push({ role: 'assistant', content: aiResponse });
        messages.push({
          role: 'user',
          content: `信息收集结果:\n${results}\n\n请基于以上信息继续完成任务。`
        });
        continue;
      } catch (error) {
        console.log(CliStyle.error(`信息收集失败: ${(error as Error).message}`));
      }
    }

    // 如果有文件操作,执行并结束
    if (fileOps.length > 0) {
      await saveDebugInfo(aiResponse, JSON.stringify(messages, null, 2));
      await handleFinalResponse(aiResponse, userPrompt, autoApply, files, operations, allResponses);
      return;
    }

    // 只有response操作,结束
    if (responseOps.length > 0 && contextOps.length === 0 && fileOps.length === 0) {
      await saveDebugInfo(aiResponse, JSON.stringify(messages, null, 2));
      const summary = buildSummary(operations, allResponses);
      await saveAiHistory(userPrompt, aiResponse, operations, new Map(), summary || '仅包含AI响应', files);
      return;
    }

    console.log(CliStyle.warning('AI 未提出有效操作，结束流程。'));
    return;
  }

  console.log(CliStyle.warning(`达到最大轮次 ${maxRounds}，结束信息收集。`));
  
  // 处理最后一轮的响应
  if (allResponses.length > 0) {
    const lastResponse = allResponses[allResponses.length - 1];
    const operations = await parseAiResponse(lastResponse);
    
    if (operations.length > 0) {
      const fileOps = operations.filter(isFileOperation);
      const responseOps = operations.filter((op): op is ResponseOperation => op.type === 'response');
      
      if (fileOps.length > 0 || responseOps.length > 0) {
        await saveDebugInfo(lastResponse, JSON.stringify(messages, null, 2));
        await handleFinalResponse(lastResponse, userPrompt, autoApply, files, operations, allResponses);
        return;
      }
    }
  }
  
  console.log(CliStyle.info('未找到可执行的操作。'));
}

async function handleFinalResponse(
  aiResponse: string,
  userPrompt: string,
  autoApply: boolean,
  files: string[],
  operations: AiOperation[],
  allResponses?: string[]
): Promise<void> {
  const fileOps = operations.filter(isFileOperation);

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

  if (fileOps.length > 0) {
    const { applied } = await reviewAndExecutePlan(
      fileOps,
      '',
      userPrompt,
      autoApply
    );
    if (applied) {
      const summary = buildSummary(operations, allResponses);
      await saveAiHistory(
        userPrompt,
        aiResponse,
        operations,
        fileOriginalContents,
        summary || `执行成功: ${fileOps.length} 个文件操作`,
        files
      );
    }
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

function buildSummary(
  operations: AiOperation[],
  allResponses?: string[]
): string {
  const parts: string[] = [];

  // 收集所有 response 操作的内容
  const responseOps = operations.filter(
    (op): op is ResponseOperation => op.type === 'response'
  );

  if (responseOps.length > 0) {
    const responseTexts = responseOps.map((op) => op.content).join('\n\n');
    parts.push(responseTexts);
  }

  // 收集所有文件操作的 comment
  const fileOps = operations.filter(
    (op): op is FileOperation => op.type !== 'response'
  );

  if (fileOps.length > 0) {
    const comments = fileOps
      .filter((op) => op.comment)
      .map((op) => `- ${op.comment}`)
      .join('\n');

    if (comments) {
      parts.push(`文件操作:\n${comments}`);
    }
  }

  return parts.join('\n\n');
}
