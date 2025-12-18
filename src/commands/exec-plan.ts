import * as fs from 'fs/promises';
import { CliStyle } from '../utils/cli-style';
import { parseOperations } from '../core/ai-response-parser';
import { reviewAndExecutePlan } from '../core/plan-reviewer';
import { saveAiHistory } from './history';
import { FileOperation, ResponseOperation } from '../core/operation-schema';

export async function executePlanFromSource(
  planContent: string,
  planSource: string,
  autoApply: boolean
): Promise<void> {
  if (!planContent?.trim()) {
    console.log(CliStyle.warning('计划内容为空。'));
    return;
  }

  console.log(CliStyle.process('\n--- 解析计划 ---'));
  const operations = await parseOperations(planContent);

  if (operations.length === 0) {
    console.log(CliStyle.warning('未找到有效操作。'));
    return;
  }

  console.log(CliStyle.success(`成功解析 ${operations.length} 个操作。`));

  const responseOps = operations.filter((op): op is ResponseOperation => op.type === 'response');
  const fileOps = operations.filter((op): op is FileOperation => op.type !== 'response');

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
    console.log(CliStyle.success('\n--- 说明 ---'));
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
    const { applied } = await reviewAndExecutePlan(fileOps, '', planSource, autoApply);
    if (applied) {
      await saveAiHistory(planSource, planContent, operations, fileOriginalContents, `执行成功: ${fileOps.length} 个文件操作`, []);
    }
  } else {
    console.log(CliStyle.success('计划执行完成（仅包含说明文本）。'));
  }
}