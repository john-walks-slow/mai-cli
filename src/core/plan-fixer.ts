import { FileOperation } from './operation-schema';
import { CliStyle } from '../utils/cli-style';
import { streamAiResponse } from '../utils/network';
import { parseAiResponse } from './ai-response-parser';
import { OperationValidator } from './operation-validator';
import * as fs from 'fs/promises';
import { ModelMessage } from 'ai';

interface FixContext {
  operation: FileOperation;
  error: string;
  fileContent?: string;
}

/**
 * 构造修复提示词
 */
function buildFixPrompt(contexts: FixContext[]): string {
  let prompt = `以下操作执行失败，请分析错误并生成修复后的操作。

**错误详情：**
`;

  contexts.forEach((ctx, i) => {
    prompt += `\n${i + 1}. 操作类型: ${ctx.operation.type}\n`;
    prompt += `   错误: ${ctx.error}\n`;

    if (ctx.operation.type === 'writeWithReplace' && ctx.operation.find) {
      prompt += `   查找文本: ${ctx.operation.find.substring(0, 100)}${
        ctx.operation.find.length > 100 ? '...' : ''
      }\n`;
    }

    if (ctx.fileContent) {
      prompt += `   文件内容:\n${ctx.fileContent.substring(0, 500)}${
        ctx.fileContent.length > 500 ? '...' : ''
      }\n`;
    }
  });

  prompt += `\n**修复要求：**
1. 仔细分析错误原因
2. 如果是 find 文本不匹配，请基于实际文件内容调整
3. 如果是文件不存在，考虑是否需要先创建
4. 输出修复后的完整操作序列
5. 必须使用正确的分隔符格式`;

  return prompt;
}

/**
 * 尝试自动修复失败的操作
 */
export async function autoFixOperations(
  failedOps: Array<{ operation: FileOperation; error: string }>,
  maxRetries: number = 3
): Promise<FileOperation[] | null> {
  console.log(
    CliStyle.warning(`\n尝试自动修复 ${failedOps.length} 个失败的操作...`)
  );

  const contexts: FixContext[] = [];

  for (const { operation, error } of failedOps) {
    const ctx: FixContext = { operation, error };

    if (operation.type === 'writeWithReplace') {
      try {
        ctx.fileContent = await fs.readFile(operation.filePath, 'utf-8');
      } catch {}
    }

    contexts.push(ctx);
  }

  const systemPrompt = `你是一个专业的代码修复助手。你的任务是分析失败的文件操作并生成修复后的正确操作。

**核心原则：**
- 仔细分析错误原因
- 基于实际文件内容调整操作
- 确保 find 文本精确匹配
- 使用正确的操作格式`;

  const userPrompt = buildFixPrompt(contexts);

  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(CliStyle.info(`修复尝试 ${attempt}/${maxRetries}...`));

      const aiResponse = await streamAiResponse(messages);
      const fixedOps = await parseAiResponse(aiResponse);

      if (fixedOps.length === 0) {
        console.log(CliStyle.warning('AI未返回有效操作'));
        continue;
      }

      const fileOps = fixedOps.filter(
        (op): op is FileOperation => op.type !== 'response'
      );

      const validation =
        await OperationValidator.validateOperationsReachability(fileOps);
      if (validation.isValid) {
        console.log(
          CliStyle.success(`✓ 修复成功，生成 ${fileOps.length} 个有效操作`)
        );
        return fileOps;
      }

      console.log(
        CliStyle.warning(
          `修复后的操作仍有问题: ${validation.errors?.join('; ')}`
        )
      );
      messages.push({ role: 'assistant', content: aiResponse });
      messages.push({
        role: 'user',
        content: `修复失败: ${validation.errors?.join('; ')}。请重新修复。`
      });
    } catch (error) {
      console.log(
        CliStyle.warning(
          `修复尝试 ${attempt} 失败: ${(error as Error).message}`
        )
      );
    }
  }

  console.log(CliStyle.error('自动修复失败，已达最大重试次数'));
  return null;
}
