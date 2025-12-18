import * as fs from 'fs/promises';
import { glob } from 'glob';
import * as path from 'path';
import { CliStyle } from '../utils/cli-style';
import { isFileIgnored } from '../utils/file-utils';
import {
  ContextOperation,
  ListDirectoryOperation,
  SearchContentOperation,
  ReadFileOperation
} from './operation-schema';
import { startDelimiter, endDelimiter } from './operation-definitions';
import { formatFileBlock } from './file-context';

/**
 * 执行列出目录操作
 */
async function executeListDirectory(
  op: ListDirectoryOperation
): Promise<string> {
  const { path: dirPath, recursive = false, maxDepth = 2 } = op;
  const rootDir = process.cwd();
  const fullPath = path.resolve(rootDir, dirPath);

  try {
    const pattern = recursive ? '**/*' : '*';
    const files = await glob(pattern, {
      cwd: fullPath,
      dot: false,
      nodir: false,
      absolute: false,
      windowsPathsNoEscape: true
    });

    const filteredFiles = files
      .filter((f) => !recursive || f.split(path.sep).length <= maxDepth)
      .slice(0, 200);

    const tree = filteredFiles
      .sort()
      .map((f) => `  ${f}`)
      .join('\n');

    return `${startDelimiter(
      'LIST_DIRECTORY_RESULT'
    )}\npath: ${dirPath}\nfiles:\n${tree}\n${endDelimiter(
      'LIST_DIRECTORY_RESULT'
    )}`;
  } catch (error) {
    return `${startDelimiter(
      'LIST_DIRECTORY_RESULT'
    )}\npath: ${dirPath}\nerror: ${(error as Error).message}\n${endDelimiter(
      'LIST_DIRECTORY_RESULT'
    )}`;
  }
}

/**
 * 执行搜索内容操作
 */
async function executeSearchContent(
  op: SearchContentOperation
): Promise<string> {
  const {
    path: searchPath,
    pattern,
    filePattern = '**/*',
    contextLines = 2
  } = op;
  const rootDir = process.cwd();
  const fullPath = path.resolve(rootDir, searchPath);

  try {
    const files = await glob(filePattern, {
      cwd: fullPath,
      dot: false,
      nodir: true,
      absolute: true,
      windowsPathsNoEscape: true
    });

    const regex = new RegExp(pattern, 'gi');
    const fileResults: string[] = [];
    let totalMatches = 0;

    for (const file of files.slice(0, 50)) {
      const relativePath = path.relative(rootDir, file);
      if (await isFileIgnored(relativePath)) continue;

      try {
        const content = await fs.readFile(file, 'utf-8');
        const lines = content.split('\n');
        const matches: Array<{ line: number; context: string[] }> = [];

        lines.forEach((line, index) => {
          if (regex.test(line) && totalMatches < 30) {
            const start = Math.max(0, index - contextLines);
            const end = Math.min(lines.length, index + contextLines + 1);
            matches.push({
              line: index + 1,
              context: lines.slice(start, end)
            });
            totalMatches++;
          }
        });

        if (matches.length > 0) {
          const matchRanges = matches.map(m => m.line).join(', ');
          const content = matches
            .map(
              (match, idx) =>
                (idx > 0 ? '\n...\n\n' : '') + match.context.join('\n')
            )
            .join('');

          const fileBlock = formatFileBlock(relativePath, content, {
            matchRanges,
            comment: `搜索 "${pattern}" 找到 ${matches.length} 处匹配`
          });
          fileResults.push(fileBlock);
        }
      } catch {}
    }

    if (fileResults.length === 0) {
      return `${startDelimiter(
        'SEARCH_CONTENT_RESULT'
      )}\npattern: ${pattern}\nmatches: 0\n未找到匹配项\n${endDelimiter(
        'SEARCH_CONTENT_RESULT'
      )}`;
    }

    return fileResults.join('\n\n');
  } catch (error) {
    return `${startDelimiter(
      'SEARCH_CONTENT_RESULT'
    )}\npattern: ${pattern}\nerror: ${(error as Error).message}\n${endDelimiter(
      'SEARCH_CONTENT_RESULT'
    )}`;
  }
}

/**
 * 执行读取文件操作
 */
async function executeReadFile(op: ReadFileOperation): Promise<string> {
  const { path: filePath, start, end, comment } = op;
  const rootDir = process.cwd();
  const fullPath = path.resolve(rootDir, filePath);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const lines = content.split('\n');

    let extractedLines: string[];
    if (start !== undefined) {
      const actualEnd =
        end !== undefined ? Math.min(end, lines.length) : lines.length;
      extractedLines = lines.slice(start - 1, actualEnd);
    } else {
      extractedLines = lines;
    }

    const rangeDesc =
      start !== undefined ? `${start}-${end ?? 'end'}` : undefined;
    return formatFileBlock(filePath, extractedLines.join('\n'), {
      range: rangeDesc,
      comment
    });
  } catch (error) {
    return formatFileBlock(filePath, `error: ${(error as Error).message}`, {});
  }
}

/**
 * 执行信息收集操作
 */
export async function executeContextOperation(
  op: ContextOperation
): Promise<string> {
  console.log(CliStyle.info(`执行信息收集: ${op.type} - ${op.comment || ''}`));

  switch (op.type) {
    case 'list_directory':
      return executeListDirectory(op);
    case 'search_content':
      return executeSearchContent(op);
    case 'read_file':
      return executeReadFile(op);
  }
}

/**
 * 批量执行信息收集操作
 */
export async function executeContextOperations(
  operations: ContextOperation[]
): Promise<string> {
  const results: string[] = [];

  for (const op of operations) {
    const result = await executeContextOperation(op);
    results.push(result);
  }

  return results.join('\n\n');
}
