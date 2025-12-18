import {
  endDelimiter,
  endDelimiterRegex,
  startDelimiter,
  startDelimiterRegex
} from './operation-definitions';
import { CliStyle } from '../utils/cli-style';
import * as JSON5 from 'json5'; // Use JSON5 for parsing flexibly
import { AiOperation } from './operation-schema';
import { OperationValidator } from './operation-validator';
import { toAbsolutePath } from '../utils/file-utils';

/**
 * 类型别名，用于清晰表示局部 AI 操作。
 */
type PartialAiOperation = Partial<AiOperation> & { [key: string]: any };

/**
 * 解析单个定界操作块的内容。
 * 职责：提取参数和内容。支持动态的 XXX_START/XXX_END 内容块，并确保定界符单独成行。
 * @param blockContent - OPERATION_START 和 OPERATION_END 之间的内容。
 * @returns 解析的 PartialAiOperation 对象。
 * @throws {Error} 如果块格式错误。
 */
async function parseSingleOperationBlock(
  blockContent: string,
  looseMode: boolean = false
): Promise<PartialAiOperation> {
  const operation: PartialAiOperation = {};
  const lines = blockContent.split('\n');

  let currentContentKey: string | null = null; // 用于跟踪当前正在捕获的内容块的键
  let contentLines: string[] = []; // 用于存储当前内容块的行

  // 处理每一行
  for (const line of lines) {
    const trimmedLine = line.trim();

    // 检查是否为新的开始定界符
    const startMatch = startDelimiterRegex.exec(trimmedLine);
    if (startMatch) {
      if (currentContentKey) {
        if (looseMode) {
          // 自动关闭上一个内容块
          operation[currentContentKey.toLowerCase()] = contentLines.join('\n');
          console.log(
            CliStyle.warning(
              `自动关闭未闭合的 ${currentContentKey.toLowerCase()} 块`
            )
          );
          contentLines = [];
        } else {
          throw new Error(
            `在 '${currentContentKey} START' 块内发现嵌套的开始定界符: '${trimmedLine}'`
          );
        }
      }
      // 设置当前内容块的键，例如, "LOG"
      currentContentKey = startMatch[1];
      continue;
    }
    // 检查是否在内容块中
    if (currentContentKey) {
      const endMatch = endDelimiterRegex.exec(trimmedLine);
      // 检查是否为当前内容块的结束定界符
      if (
        (endMatch && endMatch[1] === currentContentKey) ||
        (looseMode && trimmedLine === '--- end ---') ||
        (looseMode && trimmedLine === '--- end content ---')
      ) {
        // 将收集到的行连接成字符串并赋值给对应的键的小写形式
        // 例如, LOG_END -> operation.log
        operation[currentContentKey.toLowerCase()] = contentLines.join('\n');

        // 重置状态，准备解析下一个参数或内容块
        contentLines = [];
        currentContentKey = null;
        continue;
      } else {
        // 如果不是结束定界符，则将该行视为内容的一部分
        contentLines.push(line);
        continue;
      }
    }

    // 如果既不是内容行，也不是定界符行，则解析为参数行
    if (trimmedLine) {
      const separatorIndex = trimmedLine.indexOf(':');
      if (separatorIndex > 0) {
        const key = trimmedLine.substring(0, separatorIndex).trim();
        let value = trimmedLine.substring(separatorIndex + 1).trim();

        // 尝试解析为数字 (startLine/endLine)
        if (key === 'startLine' || key === 'endLine') {
          const numValue = Number(value);
          if (!isNaN(numValue)) {
            operation[key] = numValue;
            continue;
          }
        } else if (
          key === 'filePath' ||
          key === 'oldPath' ||
          key === 'newPath'
        ) {
          operation[key] = await toAbsolutePath(value);
          continue;
        }

        if (key && value) {
          operation[key] = value;
        }
      } else {
        console.log(CliStyle.warning(`跳过无效参数行: '${trimmedLine}'`));
      }
    }
  }

  // 确保有 type 属性
  if (!operation.type) {
    throw new Error(`操作块缺少'type'属性: ${JSON.stringify(operation)}`);
  }

  // 确保所有内容块都已正确关闭
  if (currentContentKey) {
    if (looseMode) {
      // 自动关闭最后一个内容块
      operation[currentContentKey.toLowerCase()] = contentLines.join('\n');
      console.log(
        CliStyle.warning(
          `自动关闭未闭合的 ${currentContentKey.toLowerCase()} 块`
        )
      );
    } else {
      throw new Error(`未关闭的内容块: '${currentContentKey} START'`);
    }
  }

  return operation;
}

/**
 * 从AI响应中查找定界操作块。
 * 职责：严格匹配单独成行的定界符，忽略嵌套和不完整块。
 * @param response - AI的原始字符串响应。
 * @returns 操作块内容数组。
 */
function findOperationBlocks(response: string): string[] {
  const lines = response.split('\n');
  const validBlocks: string[] = [];
  let currentBlock: string[] = [];
  let inOperationBlock = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // 操作开始（必须单独成行）
    if (trimmedLine === startDelimiter()) {
      if (inOperationBlock) {
        console.log(CliStyle.warning('发现嵌套操作开始，忽略当前块'));
        currentBlock = [];
      }
      inOperationBlock = true;
      currentBlock = [];
      continue;
    }

    // 操作结束（必须单独成行）
    if (trimmedLine === endDelimiter()) {
      if (!inOperationBlock) {
        console.log(CliStyle.warning('发现孤立操作结束，忽略'));
        continue;
      }
      inOperationBlock = false;
      const blockContent = currentBlock.join('\n'); // 不在这里 trim
      if (blockContent.trim()) {
        // 检查是否有实际内容
        validBlocks.push(blockContent);
      }
      currentBlock = [];
      continue;
    }

    // 收集操作块内内容
    if (inOperationBlock) {
      currentBlock.push(line);
    }
  }

  // 处理未关闭块
  if (inOperationBlock && currentBlock.length > 0) {
    console.log(CliStyle.warning('发现未关闭的操作块，忽略'));
  }

  return validBlocks;
}

/**
 * 解析定界格式操作。
 * 职责：处理所有定界块，验证并返回有效操作。
 * @param response - AI响应字符串。
 * @returns 验证过的操作数组。
 */
async function parseDelimitedOperations(
  response: string,
  shouldValidate = true,
  looseMode: boolean = false
): Promise<AiOperation[]> {
  const blocks = findOperationBlocks(response);
  if (!blocks.length) {
    return [];
  }

  const operations: AiOperation[] = [];
  let errors = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]; // 不在这里 trim
    if (!block.trim()) continue;

    try {
      const operation = await parseSingleOperationBlock(block, looseMode);
      if (shouldValidate) {
        // 验证操作
        const validation = OperationValidator.validateOperation(operation);
        if (!validation.isValid) {
          console.log(
            CliStyle.warning(
              `操作 ${i + 1} 验证失败: ${
                validation.errors?.join(', ') || '未知错误'
              }`
            )
          );
          errors++;
          continue;
        }
      }

      operations.push(operation as AiOperation);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(CliStyle.warning(`解析操作 ${i + 1} 失败: ${msg}`));
      errors++;
    }
  }

  if (errors > 0) {
    console.log(CliStyle.warning(`忽略了 ${errors} 个无效操作块`));
  }

  return operations;
}

/**
 * 尝试解析 JSON 格式。
 * 职责：简单 JSON5 解析和验证，回退时返回空。
 * @param response - AI响应字符串。
 * @returns 操作数组或空数组。
 * @throws {Error} 如果 JSON 解析错误，但并非由于格式不匹配。
 */
async function tryParseAsJson(response: string): Promise<AiOperation[]> {
  const trimmed = response.trim();
  // 检查是否看起来像 JSON 数组或对象
  if (
    !trimmed.startsWith('[') &&
    !(trimmed.startsWith('{') && trimmed.endsWith('}'))
  ) {
    return [];
  }

  try {
    const jsonContent = JSON5.parse(trimmed); // 使用 JSON5 进行更灵活的解析
    const operations = Array.isArray(jsonContent) ? jsonContent : [jsonContent];

    if (!operations.length) {
      return [];
    }

    // 验证所有操作
    const validation = OperationValidator.validateOperations(operations);
    if (!validation.isValid) {
      throw new Error(
        `JSON 验证失败: ${
          validation.errors?.slice(0, 3).join('; ') || '未知错误'
        }`
      );
    }

    console.log(CliStyle.info(`解析到 ${operations.length} 个JSON操作`));
    return operations as AiOperation[];
  } catch (error) {
    // 捕获 JSON5 解析错误
    if (error instanceof SyntaxError) {
      // 这是一个格式不匹配的错误，不向上抛出
      return [];
    }
    // 其他错误如验证失败则向上抛出
    throw new Error(
      `JSON 解析/验证错误: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * 主解析函数。
 * 职责：优先 JSON，其次定界格式，确保稳定解析。
 * @param response - AI响应字符串。
 * @returns 验证过的操作数组。
 */
export async function parseAiResponse(
  response: string,
  shouldValidate = true,
  looseMode: boolean = false
): Promise<AiOperation[]> {
  const trimmed = response.trim();
  if (!trimmed) {
    console.log(CliStyle.warning('AI响应为空'));
    return [];
  }

  // 尝试 JSON 解析
  try {
    const jsonOps = await tryParseAsJson(trimmed);
    if (jsonOps.length > 0) {
      return jsonOps;
    }
  } catch (error) {
    // tryParseAsJson 可能会抛出验证失败的错误，这里捕获并打印
    console.warn(
      CliStyle.warning(
        `尝试 JSON 解析失败: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    );
  }

  // 回退到定界格式
  const delimitedOps = await parseDelimitedOperations(
    trimmed,
    shouldValidate,
    looseMode
  );
  if (delimitedOps.length > 0) {
    return delimitedOps;
  }

  // 都没有成功
  const hasDelimiters = trimmed.includes(startDelimiter());
  if (hasDelimiters) {
    console.log(CliStyle.warning('检测到定界符但格式无效'));
  } else {
    // console.log(CliStyle.warning('未找到有效操作格式'));
  }

  return [];
}
