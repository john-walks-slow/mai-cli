import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import ora from 'ora';

import {
  AiOperation,
  FileOperation,
  ResponseOperation
} from './operation-schema';
import { CliStyle } from '../utils/cli-style';
import { getSystemPrompt } from '../utils/config-manager';
import { constructSystemPrompt, createUserPrompt } from '../constants/prompts';
import { parseAiResponse } from './ai-response-parser';
import { reviewAndExecutePlan } from './plan-reviewer';
import { FileContextItem, getFileContext } from './file-context';
import { getAiResponse, streamAiResponse } from '../utils/network';
import {
  formatHistoryContext,
  formatMultipleHistoryContexts,
  getRecentHistory,
  getHistoryById,
  loadHistory,
  saveHistory,
  saveAiHistory,
  parseIdOrName,
  HistoryEntry,
  updateHistoryApplied
} from '../commands/history';
import { getHistoryDepth } from '../utils/config-manager';
import { prepareAutoContext } from './context-agent';
import { ModelMessage } from 'ai';

/**
 * 处理用户请求的主调度函数。
 * @param userPrompt - 用户的AI指令。
 * @param files - 可选的文件列表作为AI的上下文。
 * @param historyIds - 可选的历史 ID 列表（逗号分隔解析）。
 * @param historyDepth - 可选的历史深度，用于自动加载最近 N 条。
 * @param systemPrompt - 可选的系统提示，传入空字符串时将使用默认系统提示。
 * @throws {Error} 如果文件处理失败或AI请求失败。
 */
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

  let historyMessages: ModelMessage[] = [];

  let fileContext = '';
  let actualUserPromptContent = '';

  // 构造系统提示
  let actualSystemPrompt: string;

  if (systemPrompt !== undefined) {
    // 明确指定（空或自定义）
    actualSystemPrompt = systemPrompt;
    if (systemPrompt) {
      console.log(
        CliStyle.info(
          `使用指定的系统提示词（长度: ${systemPrompt.length} 字符）。`
        )
      );
    } else {
      console.log(CliStyle.info('使用空系统提示词。'));
    }
  } else {
    // 检查配置文件中的系统提示
    const configSystemPrompt = await getSystemPrompt();
    if (configSystemPrompt) {
      console.log(CliStyle.info('使用配置文件中的自定义系统提示词。'));
      actualSystemPrompt = configSystemPrompt;
    } else {
      // 使用默认系统提示
      actualSystemPrompt = constructSystemPrompt();
    }
  }
  if (autoApply) {
    console.log(CliStyle.info('启用自动应用模式，无需用户确认。'));
  }
  // 步骤1：准备用户指令、文件上下文和历史上下文
  try {
    let entries: HistoryEntry[] = [];
    let additionalFiles: string[] = [];

    if (autoContext) {
      console.log(CliStyle.info('启用自动上下文准备...'));
      const autoItems: FileContextItem[] = await prepareAutoContext(userPrompt);
      additionalFiles = autoItems.map((item) => item.path);
      console.log(
        CliStyle.info(`自动上下文添加了 ${additionalFiles.length} 个文件`)
      );
    }
    if (historyIds && historyIds.length > 0) {
      console.log(
        CliStyle.info(`正在加载多个历史上下文: ${historyIds.join(', ')}`)
      );
      const history = await loadHistory();
      for (const idOrName of historyIds) {
        const result = parseIdOrName(idOrName, history);
        entries.push(result.entry!);
        // 添加历史请求中的文件到 files
        if (result.entry!.files && result.entry!.files.length > 0) {
          files.push(...result.entry!.files);
        }
      }
    } else {
      let effectiveDepth: number;
      if (historyDepth !== undefined) {
        effectiveDepth = historyDepth;
      } else {
        effectiveDepth = await getHistoryDepth();
      }
      if (effectiveDepth > 0) {
        console.log(
          CliStyle.info(`正在加载最近 ${effectiveDepth} 条历史上下文`)
        );
        entries = await getRecentHistory(effectiveDepth);
        entries.forEach((entry) => {
          if (entry.files && entry.files.length > 0) {
            files.push(...entry.files);
          }
        });
      }
    }

    // 合并 auto 上下文文件并去重
    files = [...new Set([...files, ...additionalFiles])];

    if (files.length > 0) {
      console.log(CliStyle.info('正在读取文件并为AI准备上下文...'));
      fileContext = await getFileContext(files);
    }

    actualUserPromptContent = createUserPrompt(userPrompt);

    // 构建历史消息：从最早到最近
    if (entries.length > 0) {
      const reversedEntries = entries.slice().reverse(); // 从旧到新
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
      console.log(
        CliStyle.info(`已将 ${entries.length} 条历史添加到对话历史中`)
      );
    }
  } catch (error) {
    throw new Error(`上下文准备失败: ${(error as Error).message}`);
  }

  // 获取temperature参数
  let actualTemperature: number;
  if (temperature !== undefined) {
    actualTemperature = temperature;
  } else {
    const { getTemperature } = await import('../utils/config-manager');
    actualTemperature = await getTemperature();
  }

  const aiSpinner = ora({
    text: 'AI思考中...',
    spinner: {
      interval: 80,
      frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
    }
  }).start();

  let aiResponse: string;
  const startTime = Date.now();
  let receivedChars = 0;

  const updateSpinner = () => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    if (receivedChars > 0) {
      aiSpinner.text = `AI流式响应中... (${elapsed}s, ${receivedChars} Received)`;
    } else {
      aiSpinner.text = `AI思考中... (${elapsed}s)`;
    }
  };

  // 更新计时
  const timer = setInterval(updateSpinner, 1000);

  try {
    const messages: ModelMessage[] = [
      ...(actualSystemPrompt
        ? [{ role: 'system', content: actualSystemPrompt }]
        : []),
      ...historyMessages,
      { role: 'user', content: actualUserPromptContent },
      ...(fileContext ? [{ role: 'user', content: fileContext }] : [])
    ] as ModelMessage[];

    aiResponse = await streamAiResponse(messages, {
      model,
      temperature: actualTemperature,
      onChunk: (chunk: string, response: string) => {
        // 更新接收到的字符数
        receivedChars = response.length;
        updateSpinner();
      }
    });

    const messagesJson = JSON.stringify(messages, null, 2);
    await saveAiResponseToTempFile(aiResponse, messagesJson);

    clearInterval(timer);
    const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
    aiSpinner.succeed(`AI响应成功 (${totalElapsed}s, ${receivedChars} Total)`);
  } catch (error) {
    clearInterval(timer);
    aiSpinner.fail('AI响应获取失败');
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.error(
      CliStyle.error(`AI请求失败: ${(error as Error).message} (${elapsed}s)`)
    );
    throw error;
  }

  await processAiResponse(aiResponse, userPrompt, autoApply, files);
}

/**
 * 处理原始AI响应字符串，包括解析、显示和执行。
 * @param aiResponse - AI的原始字符串响应。
 * @param userPrompt - 原始用户请求，用于历史记录。
 * @param autoApply - 是否自动应用。
 * @param files - 用户传递的文件列表，用于历史记录。
 * @throws {Error} 如果处理AI响应失败。
 */
export async function processAiResponse(
  aiResponse: string,
  userPrompt?: string,
  autoApply?: boolean,
  files?: string[]
): Promise<void> {
  if (!aiResponse?.trim()) {
    // 即使响应为空，也保存历史
    if (userPrompt) {
      await saveAiHistory(
        userPrompt,
        aiResponse,
        [],
        new Map(),
        '空AI响应',
        files
      );
    }
    console.log(CliStyle.warning('AI响应为空，无操作可执行。'));
    return;
  }

  try {
    console.log(CliStyle.process('\n--- 解析AI响应 ---'));
    const operations = await parseAiResponse(aiResponse);

    if (operations.length === 0) {
      // 保存仅响应历史
      if (userPrompt) {
        await saveAiHistory(
          userPrompt,
          aiResponse,
          [],
          new Map(),
          '仅包含AI响应',
          files
        );
      }
      console.log(CliStyle.warning('AI未提出任何结构化操作。'));
      console.log(CliStyle.info('\n--- 原始AI响应 ---'));
      console.log(CliStyle.markdown(aiResponse.trim()));
      return;
    }

    console.log(CliStyle.success(`成功解析 ${operations.length} 个操作。`));

    // 分离响应操作和文件操作
    const responseOps = operations.filter(
      (op): op is ResponseOperation => op.type === 'response'
    );
    const fileOps = operations.filter(
      (op): op is FileOperation => op.type !== 'response'
    );

    // 预加载需要备份的文件初始内容（仅文件操作）
    const filesToBackup: Set<string> = new Set();
    for (const op of fileOps) {
      if (op.type === 'writeWithReplace' || op.type === 'delete') {
        filesToBackup.add(op.filePath);
      }
    }
    const fileOriginalContents = new Map<string, string>();
    for (const filePath of filesToBackup) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        fileOriginalContents.set(filePath, content);
      } catch (err) {
        // 文件不存在，跳过
      }
    }

    // 步骤1：显示AI的文本响应
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

    // 步骤2：处理文件操作
    if (fileOps.length > 0) {
      try {
        const { applied } = await reviewAndExecutePlan(
          fileOps,
          '',
          userPrompt,
          autoApply
        );
        if (applied) {
          // 只有在应用后才保存历史
          await saveAiHistory(
            userPrompt || '未知提示',
            aiResponse,
            operations,
            fileOriginalContents,
            `执行成功: ${fileOps.length} 个文件操作`,
            files
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(`文件操作执行失败: ${errorMessage}`);
      }
    } else {
      // 纯响应操作，直接保存
      await saveAiHistory(
        userPrompt || '未知提示',
        aiResponse,
        operations,
        fileOriginalContents,
        '仅包含AI响应，无文件操作',
        files
      );
      console.log(CliStyle.success('AI操作完成（仅包含说明文本）。'));
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(CliStyle.error(`\n处理AI响应失败: ${errorMessage}`));

    // 即使失败，也尝试保存历史（如果未保存）
    if (userPrompt) {
      try {
        await saveAiHistory(
          userPrompt,
          aiResponse,
          [],
          new Map(),
          `处理失败: ${errorMessage}`,
          files
        );
      } catch {}
    }

    // 优雅降级：显示原始响应
    console.log(CliStyle.warning('\n由于解析错误，显示AI的原始响应:'));
    console.log(CliStyle.info('\n--- 原始AI响应 ---'));
    console.log(CliStyle.markdown(aiResponse.substring(0, 100))); // 限制长度
    if (aiResponse.length > 100) {
      console.log(
        CliStyle.muted(
          `... (响应被截断，还有 ${aiResponse.length - 100} 个字符)`
        )
      );
    }
    console.log(CliStyle.info('--- 原始响应结束 ---\n'));
    // Rethrow the error to indicate failure in the overall process
    throw error;
  }
}

/**
 * 更新历史记录的描述。
 * @param id - 历史ID。
 * @param newDescription - 新描述。
 */
async function updateHistoryDescription(
  id: string,
  newDescription: string
): Promise<void> {
  const history = await loadHistory();
  const entry = history.find((h: HistoryEntry) => h.id === id);
  if (entry) {
    entry.description = newDescription;
    await saveHistory(history);
  }
}

/**
 * 将AI响应保存到临时文件，便于调试。
 * @param aiResponse - AI响应内容。
 * @param messagesJson - 完整的 messages JSON 字符串。
 */
async function saveAiResponseToTempFile(
  aiResponse: string,
  messagesJson: string
): Promise<void> {
  try {
    const tempDir = os.tmpdir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePrompt = 'messages'; // 使用固定名称，因为现在是 messages JSON
    const tempFileName = `mai-ai-response-${timestamp}-${safePrompt}.md`;
    const tempFilePath = path.join(tempDir, tempFileName);

    const saveContent = [
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

    await fs.writeFile(tempFilePath, saveContent, 'utf-8');
    console.log(CliStyle.muted(`AI响应已保存: ${tempFilePath}`));
  } catch (error) {
    // 非关键错误，不抛出异常
    console.log(
      CliStyle.warning(`无法保存AI响应到临时文件: ${(error as Error).message}`)
    );
  }
}
