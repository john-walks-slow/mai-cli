import { ContextBuilder } from './context-builder';
import { ResponseHandler } from './response-handler';
import { RequestOrchestrator } from './orchestrator';
import { CliStyle } from '../utils/cli-style';
import { parseAiResponse } from './ai-response-parser';
import { reviewAndExecutePlan } from './plan-reviewer';
import {
  HistoryEntry,
  loadHistory,
  saveAiHistory,
  saveHistory
} from '../commands/history';
import {
  AiOperation,
  FileOperation,
  ResponseOperation
} from './operation-schema';
import * as fs from 'fs/promises';
import path from 'path';

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
  const orchestrator = new RequestOrchestrator(
    new ContextBuilder(),
    new ResponseHandler()
  );

  await orchestrator.process(
    userPrompt,
    files,
    historyIds,
    historyDepth,
    systemPrompt,
    autoContext,
    autoApply,
    model,
    temperature
  );
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
