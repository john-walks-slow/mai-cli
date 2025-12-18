import { ModelMessage } from 'ai';
import { getFileContext } from './file-context';
import { getRecentHistory, loadHistory, parseIdOrName, HistoryEntry } from '../commands/history';
import { getHistoryDepth } from '../utils/config-manager';
import { CliStyle } from '../utils/cli-style';
import { prepareAutoContext } from './context-agent';
import { createUserPrompt } from '../constants/prompts';

export class ContextBuilder {
  async build(
    userPrompt: string,
    files: string[],
    historyIds?: string[],
    historyDepth?: number,
    autoContext?: boolean
  ): Promise<{ messages: ModelMessage[]; fileContext: string }> {
    let historyMessages: ModelMessage[] = [];
    let fileContext = '';
    let entries: HistoryEntry[] = [];
    let additionalFiles: string[] = [];

    if (autoContext) {
      console.log(CliStyle.info('启用自动上下文准备...'));
      const autoItems = await prepareAutoContext(userPrompt);
      additionalFiles = autoItems.map((item) => item.path);
      console.log(CliStyle.info(`自动上下文添加了 ${additionalFiles.length} 个文件`));
    }

    if (historyIds && historyIds.length > 0) {
      console.log(CliStyle.info(`正在加载多个历史上下文: ${historyIds.join(', ')}`));
      const history = await loadHistory();
      for (const idOrName of historyIds) {
        const result = parseIdOrName(idOrName, history);
        entries.push(result.entry!);
        if (result.entry!.files && result.entry!.files.length > 0) {
          files.push(...result.entry!.files);
        }
      }
    } else {
      let effectiveDepth = historyDepth !== undefined ? historyDepth : await getHistoryDepth();
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
        historyMessages.push({ role: 'assistant', content: entry.aiResponse || '' });
        if (entry.applied !== undefined) {
          const choice = entry.applied ? '应用' : '放弃';
          historyMessages.push({ role: 'user', content: `用户选择了${choice}该计划。` });
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

    return { messages, fileContext };
  }
}