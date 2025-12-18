import { AiOperation, FileOperation, ResponseOperation } from './operation-schema';
import { parseAiResponse } from './ai-response-parser';
import { reviewAndExecutePlan } from './plan-reviewer';
import { saveAiHistory } from '../commands/history';
import { CliStyle } from '../utils/cli-style';
import * as fs from 'fs/promises';

export class ResponseHandler {
  async handle(
    aiResponse: string,
    userPrompt: string,
    autoApply: boolean,
    files: string[]
  ): Promise<void> {
    if (!aiResponse?.trim()) {
      await saveAiHistory(userPrompt, aiResponse, [], new Map(), '空AI响应', files);
      console.log(CliStyle.warning('AI响应为空，无操作可执行。'));
      return;
    }

    console.log(CliStyle.process('\n--- 解析AI响应 ---'));
    const operations = await parseAiResponse(aiResponse);

    if (operations.length === 0) {
      await saveAiHistory(userPrompt, aiResponse, [], new Map(), '仅包含AI响应', files);
      console.log(CliStyle.warning('AI未提出任何结构化操作。'));
      console.log(CliStyle.info('\n--- 原始AI响应 ---'));
      console.log(CliStyle.markdown(aiResponse.trim()));
      return;
    }

    console.log(CliStyle.success(`成功解析 ${operations.length} 个操作。`));

    const responseOps = operations.filter((op): op is ResponseOperation => op.type === 'response');
    const fileOps = operations.filter((op): op is FileOperation => op.type !== 'response');

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
      const { applied } = await reviewAndExecutePlan(fileOps, '', userPrompt, autoApply);
      if (applied) {
        await saveAiHistory(userPrompt, aiResponse, operations, fileOriginalContents, `执行成功: ${fileOps.length} 个文件操作`, files);
      }
    } else {
      await saveAiHistory(userPrompt, aiResponse, operations, fileOriginalContents, '仅包含AI响应，无文件操作', files);
      console.log(CliStyle.success('AI操作完成（仅包含说明文本）。'));
    }
  }
}