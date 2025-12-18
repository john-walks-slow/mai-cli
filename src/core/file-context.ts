import * as fs from 'fs/promises';
import * as path from 'path';
import { glob } from 'glob';
import { CliStyle } from '../utils/cli-style';
import { startDelimiter, endDelimiter } from './operation-definitions';
import { writeFileSync } from 'fs';
import { isFileIgnored } from '../utils/file-utils';

export interface FileContextItem {
  path: string;
  content?: string;
  comment?: string;
  start?: number;
  end?: number;
}

export async function writeFileContext(filePatterns: string[]) {
  writeFileSync('./fileContext.txt', await getFileContext(filePatterns));
  console.log(CliStyle.success('已写入文件: ./fileContext.txt'));
}

/**
 * 读取指定文件的内容并将其格式化为上下文。
 * 支持文件路径中的 glob 模式以包含多个文件。
 * @param filePatterns - 文件路径或 glob 模式数组。
 * @returns 包含连接文件上下文的字符串。
 */
export async function getFileContext(filePatterns: string[]): Promise<string> {
  const contents: string[] = [];
  const fileRanges = new Map<string, Array<{ start?: number; end?: number }>>();

  for (const pattern of filePatterns) {
    try {
      // 检查是否包含 glob 字符
      const hasGlobChars = /[*?[\]]/.test(pattern);
      if (hasGlobChars) {
        // 使用 glob 扩展，输出全文
        const matchedFiles = await glob(pattern, {
          dot: true,
          absolute: true,
          windowsPathsNoEscape: true
        });
        const rootDir = process.cwd();
        for (const file of matchedFiles) {
          // 应用 .maiignore 过滤
          const relativePath = path.relative(rootDir, file);
          if (await isFileIgnored(relativePath)) continue;
          
          const ranges = fileRanges.get(file) || [];
          ranges.push({ start: undefined, end: undefined });
          fileRanges.set(file, ranges);
        }
      } else {
        // 视为具体文件，尝试解析范围
        const rangeRegex = /:(\d+(?:-\d*)?)$/;
        const rangeMatch = pattern.match(rangeRegex);
        let filePath = pattern;
        let start: number | undefined;
        let end: number | undefined;

        if (rangeMatch) {
          filePath = pattern.replace(rangeRegex, '');
          const rangeStr = rangeMatch[1];
          const dashIndex = rangeStr.indexOf('-');
          const startStr = rangeStr.substring(
            0,
            dashIndex >= 0 ? dashIndex : rangeStr.length
          );
          const endStr =
            dashIndex >= 0 ? rangeStr.substring(dashIndex + 1) : '';
          start = parseInt(startStr, 10);
          end = endStr ? parseInt(endStr, 10) : undefined;
          if (isNaN(start) || start < 1) {
            // 解析失败，全文
            start = undefined;
            end = undefined;
          }
        }

        // 检查文件是否存在（但暂不添加，稍后统一处理）
        const ranges = fileRanges.get(filePath) || [];
        ranges.push({ start, end });
        fileRanges.set(filePath, ranges);
      }
    } catch (error) {
      console.log(
        CliStyle.warning(
          `警告: 处理模式 '${pattern}' 时出错。错误: ${
            (error as Error).message
          }`
        )
      );
    }
  }
  // 构建 items 数组
  const items: FileContextItem[] = [];

  for (const [file, ranges] of fileRanges.entries()) {
    if (ranges.length === 0) continue;

    // 计算交集：max start, min end
    let maxStart = 1;
    let minEnd = Infinity;
    for (const r of ranges) {
      const s = r.start ?? 1;
      const e = r.end ?? Infinity;
      maxStart = Math.max(maxStart, s);
      minEnd = Math.min(minEnd, e);
    }

    if (maxStart > minEnd) {
      console.log(
        CliStyle.warning(`警告: 文件 ${file} 的指定范围无交集，跳过。`)
      );
      continue;
    }

    const effectiveStart = maxStart;
    const effectiveEnd = minEnd === Infinity ? undefined : minEnd;

    // 检查文件是否存在
    try {
      await fs.access(file);
      items.push({
        path: file,
        start: effectiveStart,
        end: effectiveEnd,
        comment: undefined
      });
    } catch (accessError) {
      console.log(
        CliStyle.warning(
          `警告: 文件不存在或无法访问 '${file}'，跳过。错误: ${
            (accessError as Error).message
          }`
        )
      );
    }
  }

  if (items.length === 0) {
    console.log(CliStyle.warning('警告: 未找到与提供模式匹配的文件。'));
    return '';
  }

  return await formatFileContexts(items);
}

/**
 * 格式化文件上下文对象数组。为未来扩展准备，支持 comment。
 * @param items - 包含文件路径（不支持 glob）、行号范围（可选）和 comment（可选）的对象数组。
 * @returns 格式化的上下文字符串。
 */
export async function formatFileContexts(
  items: FileContextItem[]
): Promise<string> {
  const contents: string[] = [];

  for (const item of items) {
    try {
      await addFileContent(item, contents);
    } catch (error) {
      console.log(
        CliStyle.warning(
          `警告: 处理文件 ${item.path} 时出错。错误: ${
            (error as Error).message
          }`
        )
      );
    }
  }
  if (contents.length === 0) {
    return '';
  }

  console.log(CliStyle.success(`成功添加 ${items.length} 个文件。`));
  return contents.join('\n\n');

  async function addFileContent(
    item: { path: string; start?: number; end?: number; comment?: string },
    contents: string[]
  ) {
    try {
      const stat = await fs.stat(item.path);
      if (stat.isDirectory()) {
        return;
      }
      const content = await fs.readFile(item.path, 'utf-8');
      const lines = content.split('\n');

      let extractedLines: string[];
      let displayStart: number;
      if (item.start !== undefined) {
        displayStart = item.start;
        const actualEnd =
          item.end !== undefined
            ? Math.min(item.end, lines.length)
            : lines.length;
        extractedLines = lines.slice(item.start - 1, actualEnd);
        if (extractedLines.length === 0) {
          console.log(
            CliStyle.warning(
              `警告: 文件 ${item.path} 中范围 ${item.start}-${
                item.end ?? 'end'
              } 为空，跳过。`
            )
          );
          return;
        }
      } else {
        displayStart = 1;
        extractedLines = lines;
      }

      // 添加行号标记
      const numberedContent = extractedLines
        .map(
          (line, index) => `${String(displayStart + index).padStart(4)}|${line}`
        )
        .join('\n');
      let fileBlock = `${startDelimiter('FILE')}\n`;
      fileBlock += `${startDelimiter('metadata')}\npath: ${item.path}\n`;
      const rangeDesc =
        item.start !== undefined ? `${item.start}-${item.end ?? 'end'}` : '';
      if (rangeDesc) {
        fileBlock += `range: ${rangeDesc}\n`;
      }
      if (item.comment) {
        fileBlock += `comment: ${item.comment}\n`;
      }
      fileBlock += `${endDelimiter('metadata')}\n`;
      // fileBlock += `\n${numberedContent}\n${endDelimiter('FILE')}`;
      fileBlock += `${startDelimiter('content')}\n`;
      fileBlock += `${extractedLines.join('\n')}\n`;
      fileBlock += `${endDelimiter('content')}\n`;
      fileBlock += endDelimiter('FILE');
      contents.push(fileBlock);
    } catch (error) {
      console.log(
        CliStyle.warning(
          `警告: 无法读取文件 ${item.path}，跳过。错误: ${
            (error as Error).message
          }`
        )
      );
    }
  }
}
