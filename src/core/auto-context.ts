import { glob } from 'glob';
import * as path from 'path';
import { CliStyle } from '../utils/cli-style';
import { getAiResponse } from '../utils/network';
import { isFileIgnored } from '../utils/file-utils';

/**
 * 获取项目文件树（限制深度和数量，避免过大）
 */
async function getProjectFileTree(maxDepth: number = 3): Promise<string> {
  const rootDir = process.cwd();
  const files = await glob('**/*', {
    dot: false,
    nodir: false,
    absolute: false,
    windowsPathsNoEscape: true,
    ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '*.log']
  });

  // 按深度过滤
  const filteredFiles = files
    .filter((f) => f.split(path.sep).length <= maxDepth)
    .slice(0, 500); // 最多500个文件

  // 构建树形结构文本
  const tree = filteredFiles
    .sort()
    .map((f) => `  ${f}`)
    .join('\n');

  return `项目根目录: ${rootDir}\n文件结构:\n${tree}`;
}

/**
 * 使用AI推荐相关文件
 */
async function recommendFiles(
  userTask: string,
  projectTree: string
): Promise<string[]> {
  const systemPrompt = `你是一个代码项目分析助手。根据用户任务和项目结构，推荐最相关的文件。

规则:
- 只输出文件路径列表，每行一个，使用相对路径
- 不要输出目录，只输出文件
- 优先推荐核心实现文件
- 通常5-15个文件足够
- 不要添加任何解释或注释`;

  const userPrompt = `用户任务: ${userTask}

${projectTree}

请列出完成此任务需要查看的相关文件路径:`;

  const response = await getAiResponse([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);

  // 解析文件路径
  const lines = response
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('//'));

  return lines;
}

/**
 * 验证并过滤文件路径
 */
async function validateFiles(files: string[]): Promise<string[]> {
  const rootDir = process.cwd();
  const validFiles: string[] = [];

  for (const file of files) {
    const fullPath = path.resolve(rootDir, file);

    // 检查是否被忽略
    if (await isFileIgnored(file)) {
      console.log(CliStyle.muted(`跳过被忽略的文件: ${file}`));
      continue;
    }

    // 检查文件是否存在
    try {
      const fs = await import('fs/promises');
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        validFiles.push(fullPath);
      }
    } catch {
      console.log(CliStyle.warning(`文件不存在: ${file}`));
    }
  }

  return validFiles;
}

/**
 * 自动准备上下文 - 简化版
 * @param userTask 用户任务描述
 * @returns 推荐的文件路径列表（绝对路径）
 */
export async function prepareAutoContext(userTask: string): Promise<string[]> {
  console.log(CliStyle.info('正在分析项目结构...'));
  const projectTree = await getProjectFileTree();

  console.log(CliStyle.info('正在请求AI推荐相关文件...'));
  const recommendedFiles = await recommendFiles(userTask, projectTree);

  console.log(
    CliStyle.info(`AI推荐了 ${recommendedFiles.length} 个文件，正在验证...`)
  );
  const validFiles = await validateFiles(recommendedFiles);

  console.log(
    CliStyle.success(`自动上下文准备完成: ${validFiles.length} 个有效文件`)
  );

  if (validFiles.length > 0) {
    console.log(CliStyle.muted('推荐的文件:'));
    validFiles.forEach((f) => {
      const relative = path.relative(process.cwd(), f);
      console.log(CliStyle.muted(`  - ${relative}`));
    });
  }

  return validFiles;
}