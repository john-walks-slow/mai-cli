import * as fs from 'fs/promises';
import * as path from 'path';

import { CliStyle } from '../utils/cli-style';
import { reviewAndExecutePlan } from '../core/plan-reviewer';
import { AiOperation, FileOperation } from '../core/operation-schema';
import { startDelimiter, endDelimiter } from '../core/operation-definitions';
import * as os from 'os';
import { MAI_CONFIG_DIR_NAME, HISTORY_FILE_NAME } from '../constants/mai-data';

/**
 * 获取历史记录文件路径，根据配置的scope返回全局或项目级别路径。
 */
export async function getHistoryFile(): Promise<string> {
  const { getHistoryScope } = await import('../utils/config-manager');
  const scope = await getHistoryScope();
  
  if (scope === 'project') {
    const { findGitRoot } = await import('../utils/file-utils');
    try {
      const projectRoot = await findGitRoot();
      const projectHistoryDir = path.join(projectRoot, MAI_CONFIG_DIR_NAME);
      await fs.mkdir(projectHistoryDir, { recursive: true });
      return path.join(projectHistoryDir, HISTORY_FILE_NAME);
    } catch {
      // 回退到全局
      console.warn('无法确定项目根目录，使用全局历史记录');
    }
  }
  
  return path.join(os.homedir(), MAI_CONFIG_DIR_NAME, HISTORY_FILE_NAME);
}

/**
 * 历史记录条目接口。
 */
export interface HistoryEntry {
  id: string;
  name?: string;
  description?: string;
  timestamp: string;
  prompt: string;
  aiResponse?: string;
  operations: AiOperation[]; // 使用新的 operations 字段，包含所有操作类型
  originalFileContents?: Record<string, string>; // 存储操作前文件的原始内容，用于撤销
  applied?: boolean; // 是否已应用结果
  files?: string[]; // 用户传递的文件列表，用于上下文
}

/**
 * 解析用户输入的 ID 或名称，支持 ~n 索引格式。
 * @param idOrName - 用户输入的 ID、名称或索引字符串。
 * @param history - 历史记录列表。
 * @returns 包含历史记录条目、索引和是否为索引格式的对象。
 * @throws {Error} 如果未找到历史记录或索引超出范围。
 */
export function parseIdOrName(
  idOrName: string,
  history: HistoryEntry[]
): { entry?: HistoryEntry; index?: number; isIndex: boolean } {
  // 检查是否为索引格式 ~n
  if (idOrName.startsWith('~') && /^\~\d+$/.test(idOrName)) {
    const index = parseInt(idOrName.slice(1), 10);
    if (index > 0 && index <= history.length) {
      return { entry: history[index - 1], index: index - 1, isIndex: true };
    } else {
      throw new Error(
        `索引 ${idOrName} 超出范围 (有效范围: 1-${history.length})`
      );
    }
  }

  // 按 ID 或名称查找
  const foundEntry = history.find(
    (h) => h.id === idOrName || h.name === idOrName
  );
  if (foundEntry) {
    const index = history.indexOf(foundEntry);
    return { entry: foundEntry, index, isIndex: false };
  }

  throw new Error(`未找到历史记录: ${idOrName}`);
}

/**
 * 加载历史记录。
 * @returns 历史记录条目数组。
 */
export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const historyFile = await getHistoryFile();
    const data = await fs.readFile(historyFile, 'utf-8');
    return JSON.parse(data) as HistoryEntry[];
  } catch {
    return [];
  }
}

/**
 * 保存历史记录。
 * @param history - 要保存的历史记录数组。
 */
export async function saveHistory(history: HistoryEntry[]): Promise<void> {
  const historyFile = await getHistoryFile();
  await fs.writeFile(
    historyFile,
    JSON.stringify(history, null, 2),
    'utf-8'
  );
}

/**
 * 将新的历史记录条目追加到历史记录中。
 * @param entry - 要追加的历史记录条目。
 */
export async function appendHistory(entry: HistoryEntry): Promise<void> {
  const history = await loadHistory();
  history.unshift(entry);
  await saveHistory(history);
}

/**
 * 列出所有历史记录。
 * @param filterFileOnly - 是否只显示包含文件操作的历史记录。
 */
export async function listHistory(
  filterFileOnly: boolean = false
): Promise<void> {
  const history = await loadHistory();
  if (history.length === 0) {
    console.log(CliStyle.info('没有历史记录。'));
    return;
  }

  let displayHistory = history;
  let noRecordsMsg = '没有历史记录。';
  if (filterFileOnly) {
    displayHistory = history.filter((entry) =>
      entry.operations.some((op) => op.type !== 'response')
    );
    noRecordsMsg = '没有包含文件操作的历史记录。';
  }

  if (displayHistory.length === 0) {
    console.log(CliStyle.info(noRecordsMsg));
    return;
  }

  console.log(
    CliStyle.success(`历史记录${filterFileOnly ? ' (仅包含文件操作)' : ''}:`)
  );
  console.log(
    CliStyle.muted(
      '使用 ~n 格式（如 ~1 表示最近一次，基于所有历史记录）来引用历史记录。'
    )
  );

  displayHistory.forEach((entry, displayIndex) => {
    const originalIndex = history.indexOf(entry);
    const originalDisplayIndex = originalIndex + 1;
    const idOrName = entry.name || entry.id;
    const totalOps = entry.operations.length;
    const fileOps = entry.operations.filter((op) => op.type !== 'response');
    const fileOpCount = fileOps.length;
    const responseCount = totalOps - fileOpCount;

    const appliedStatus =
      entry.applied === undefined
        ? ''
        : entry.applied
        ? ' (已应用)'
        : ' (未应用)';
    console.log(
      `${CliStyle.info(
        `${
          displayIndex + 1
        }. ${idOrName} (~${originalDisplayIndex})${appliedStatus}`
      )} - ${entry.description} (${new Date(entry.timestamp).toLocaleString()})`
    );
    console.log(
      `   提示: ${CliStyle.muted(
        entry.prompt.substring(0, 50) + (entry.prompt.length > 50 ? '...' : '')
      )}`
    );
    console.log(
      `   操作: ${fileOpCount} 文件操作 ${
        responseCount > 0 ? `+ ${responseCount} 响应` : ''
      }${fileOpCount === 0 ? ' (纯AI响应)' : ''}`
    );
    console.log();
  });
}

/**
 * 撤销指定的历史记录所做的更改。
 * @param idOrName - 要撤销的历史记录的 ID、名称或索引。
 */
export async function undoHistory(idOrName: string): Promise<void> {
  const history = await loadHistory();
  if (history.length === 0) {
    console.error(CliStyle.error('没有历史记录可撤销。'));
    return;
  }

  let entry: HistoryEntry;
  let index: number | undefined;
  let isIndex = false;

  try {
    const result = parseIdOrName(idOrName, history);
    entry = result.entry!;
    index = result.index;
    isIndex = result.isIndex;
  } catch (error) {
    console.error(CliStyle.error(String(error)));
    return;
  }

  const displayId = isIndex ? `~${index! + 1}` : entry.name || entry.id;
  console.log(
    CliStyle.process(`正在撤销: ${entry.description} (${displayId})`)
  );
  console.log(CliStyle.muted(`涉及 ${entry.operations.length} 个操作`));

  // 只处理文件操作，忽略 response 操作
  const fileOperations = entry.operations.filter(
    (op): op is FileOperation => op.type !== 'response'
  );

  // 生成undo operations，在reverse order
  const reversedFileOps = fileOperations.slice().reverse();
  const undoOperations: FileOperation[] = [];

  for (const op of reversedFileOps) {
    let undoOp: FileOperation | undefined;

    switch (op.type) {
      case 'create':
        undoOp = {
          type: 'delete',
          filePath: op.filePath,
          comment: `撤销创建: ${op.filePath}`
        };
        break;

      case 'delete':
        const originalContentForDelete =
          entry.originalFileContents?.[op.filePath];
        if (originalContentForDelete !== undefined) {
          undoOp = {
            type: 'create',
            filePath: op.filePath,
            content: originalContentForDelete,
            comment: `撤销删除: 恢复 ${op.filePath}`
          };
        }
        break;

      case 'move':
        if (op.oldPath) {
          undoOp = {
            type: 'move',
            oldPath: op.newPath,
            newPath: op.oldPath,
            comment: `撤销移动: ${op.newPath} -> ${op.oldPath}`
          };
        }
        break;

      case 'writeWithReplace':
        const originalContentForReplace =
          entry.originalFileContents?.[op.filePath];
        if (originalContentForReplace !== undefined) {
          // 使用 create 来覆盖整个文件恢复原始内容
          undoOp = {
            type: 'writeWithReplace',
            filePath: op.filePath,
            content: originalContentForReplace,
            comment: `撤销替换: 恢复 ${op.filePath} 原始内容`
          };
        }
        break;

      // All FileOperation types are covered, no default needed
    }

    if (undoOp) {
      undoOperations.push(undoOp);
    }
  }

  if (undoOperations.length === 0) {
    console.log(CliStyle.warning('没有可撤销的操作。'));
    return;
  }

  console.log(CliStyle.process(`生成 ${undoOperations.length} 个撤销操作。`));

  // 使用 plan-reviewer 执行撤销计划
  try {
    await reviewAndExecutePlan(undoOperations, '撤销计划审查:', entry.prompt);
    console.log(
      CliStyle.success(`\n撤销完成: ${entry.description} (${displayId})`)
    );
  } catch (error) {
    console.error(
      CliStyle.error(`撤销计划执行失败: ${(error as Error).message}`)
    );
  }
  // 保留历史记录以支持 redo
}

/**
 * 重新应用指定的历史记录所做的更改。
 * @param idOrName - 要重新应用的历史记录的 ID、名称或索引。
 * @param force - 是否强制重新应用，跳过内容变化检查。
 */
export async function redoHistory(idOrName: string): Promise<void> {
  const history = await loadHistory();

  if (history.length === 0) {
    console.error(CliStyle.error('没有历史记录可重新应用。'));
    return;
  }

  let entry: HistoryEntry;
  let index: number | undefined;
  let isIndex = false;

  try {
    const result = parseIdOrName(idOrName, history);
    entry = result.entry!;
    index = result.index;
    isIndex = result.isIndex;
  } catch (error) {
    console.error(CliStyle.error(String(error)));
    return;
  }

  const displayId = isIndex ? `~${index! + 1}` : entry.name || entry.id;
  console.log(CliStyle.process(`正在重新应用: ${displayId}`));
  console.log(
    CliStyle.muted(
      `涉及 ${
        entry.operations.filter((op) => op.type !== 'response').length
      } 个文件操作`
    )
  );
  await reviewAndExecutePlan(
    entry.operations.filter((op) => op.type !== 'response'),
    ``,
    entry.prompt
  );
}

/**
 * 保存AI历史记录，包括响应和操作。
 * @param userPrompt - 用户提示。
 * @param aiResponse - AI原始响应。
 * @param operations - 所有操作（response + file）。
 * @param fileOriginalContents - 原始文件内容映射（仅文件操作）。
 * @param executionDescription - 执行描述，可选。
 * @param files - 用户传递的文件列表，可选。
 */
export async function saveAiHistory(
  userPrompt: string,
  aiResponse: string,
  operations: AiOperation[],
  fileOriginalContents: Map<string, string> = new Map(),
  executionDescription?: string,
  files?: string[]
): Promise<HistoryEntry> {
  try {
    console.log(CliStyle.muted('正在保存本次AI对话历史...'));

    const originalFileContents: Record<string, string> =
      Object.fromEntries(fileOriginalContents);

    const historyEntry: HistoryEntry = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      prompt: userPrompt,
      aiResponse,
      description:
        executionDescription || `AI响应和 ${operations.length} 个操作`,
      operations,
      originalFileContents:
        Object.keys(originalFileContents).length > 0
          ? originalFileContents
          : undefined,
      applied: operations.some((op) => op.type !== 'response') ? true : undefined,
      ...(files && files.length > 0 ? { files } : {})
    };

    await appendHistory(historyEntry);
    return historyEntry;
  } catch (error) {
    console.log(
      CliStyle.warning(`警告：无法保存AI历史: ${(error as Error).message}`)
    );
    throw error;
  }
}

/**
 * 删除指定的历史记录。
 * @param idOrName - 要删除的历史记录的 ID、名称或索引。
 */
export async function deleteHistory(idOrName: string): Promise<void> {
  const history = await loadHistory();
  if (history.length === 0) {
    console.error(CliStyle.error('没有历史记录可删除。'));
    return;
  }

  let entry: HistoryEntry | undefined;
  let index: number | undefined;
  let isIndex = false;

  try {
    const result = parseIdOrName(idOrName, history);
    entry = result.entry;
    index = result.index;
    isIndex = result.isIndex;
  } catch (error) {
    console.error(CliStyle.error(String(error)));
    return;
  }

  if (!entry) {
    console.error(CliStyle.error(`未找到历史记录: ${idOrName}`));
    return;
  }

  const displayId = isIndex ? `~${index! + 1}` : entry.name || entry.id;
  const initialLength = history.length;
  const filteredHistory = history.filter((h) => h !== entry);

  await saveHistory(filteredHistory);
  console.log(
    CliStyle.success(
      `已删除历史记录: ${displayId} (${
        initialLength - filteredHistory.length
      } 个条目）`
    )
  );
}

export async function getHistoryById(
  idOrName: string
): Promise<HistoryEntry | undefined> {
  try {
    const history = await loadHistory();
    if (history.length === 0) {
      return undefined;
    }
    const result = parseIdOrName(idOrName, history);
    return result.entry;
  } catch {
    return undefined;
  }
}

/**
 * 清除所有历史记录。
 */
export async function clearHistory(): Promise<void> {
  const history = await loadHistory();
  if (history.length === 0) {
    console.log(CliStyle.info('没有历史记录可清除。'));
    return;
  }
  await saveHistory([]);
  console.log(CliStyle.success(`已清除 ${history.length} 条历史记录。`));
}

/**
 * 格式化历史上下文字符串，用于 AI prompt。
 * @param entry - 历史条目。
 * @returns 格式化的历史上下文字符串。
 */
export function formatHistoryContext(entry: HistoryEntry): string {
  const operationsJson = JSON.stringify(entry.operations, null, 2);
  const aiResponse = entry.aiResponse || 'N/A';
  let historyContent = `${startDelimiter('HISTORY')}\nid: ${
    entry.id
  }\ntimestamp: ${entry.timestamp}\nprompt: ${entry.prompt}\ndescription: ${
    entry.description || 'N/A'
  }`;
  if (entry.files && entry.files.length > 0) {
    historyContent += `\nfiles: ${JSON.stringify(entry.files)}`;
  }
  if (entry.operations.length === 0) {
    historyContent += `\naiResponse: ${aiResponse}`;
  } else {
    historyContent += `\noperations: ${operationsJson}`;
  }
  historyContent += `\n${endDelimiter('HISTORY')}`;
  return historyContent;
}

/**
 * 获取最近的历史记录。
 * @param depth - 要获取的历史数量。
 * @returns 最近的历史条目数组。
 */
export async function getRecentHistory(depth: number): Promise<HistoryEntry[]> {
  if (depth < 1) return [];
  const history = await loadHistory();
  return history.slice(0, depth);
}

/**
 * 格式化多个历史条目的上下文字符串，用于 AI prompt。
 * @param entries - 历史条目数组。
 * @returns 格式化的多个历史上下文字符串。
 */
export function formatMultipleHistoryContexts(entries: HistoryEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((entry) => formatHistoryContext(entry))
    .join('\n\n---\n\n');
}

/**
 * 更新历史记录的应用状态。
 * @param id - 历史ID。
 * @param applied - 是否已应用。
 */
export async function updateHistoryApplied(
  id: string,
  applied: boolean
): Promise<void> {
  const history = await loadHistory();
  const entry = history.find((h: HistoryEntry) => h.id === id);
  if (entry) {
    entry.applied = applied;
    await saveHistory(history);
  }
}
