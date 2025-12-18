import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { CliStyle } from './cli-style';
import { getDiffViewer } from './config-manager';

/**
 * 在用户的默认文本编辑器中打开内容（硬编码为VS Code）。
 * 进程会等待编辑器关闭。
 * @param content - 要编辑的内容。
 * @returns 编辑器关闭后的内容。
 */
export async function openInEditor(content: string): Promise<string> {
  const editor = 'code'; // 硬编码为VS Code
  const projectRoot = process.cwd();
  const tempFilePath = path.join(os.tmpdir(), `mai-edit-${Date.now()}.tmp`);

  try {
    await fs.writeFile(tempFilePath, content, 'utf8');
    await runProcess(editor, [
      '--folder-uri',
      projectRoot,
      '--wait',
      tempFilePath
    ]);
    return await fs.readFile(tempFilePath, 'utf8');
  } finally {
    await fs.unlink(tempFilePath).catch(() => {
      /* 清理时忽略错误 */
    });
  }
}

/**
 * 生成统一diff patch格式
 */
function generateUnifiedDiff(
  originalContent: string,
  newContent: string,
  filePath: string
): string {
  const originalLines = originalContent.split('\n');
  const newLines = newContent.split('\n');
  
  let diff = `--- ${filePath}\n+++ ${filePath}\n`;
  
  const maxLen = Math.max(originalLines.length, newLines.length);
  let hunkStart = -1;
  let hunkLines: string[] = [];
  let oldCount = 0;
  let newCount = 0;
  
  const flushHunk = () => {
    if (hunkStart !== -1 && hunkLines.length > 0) {
      diff += `@@ -${hunkStart + 1},${oldCount} +${hunkStart + 1},${newCount} @@\n`;
      diff += hunkLines.join('\n') + '\n';
      hunkStart = -1;
      hunkLines = [];
      oldCount = 0;
      newCount = 0;
    }
  };
  
  for (let i = 0; i < maxLen; i++) {
    const oldLine = originalLines[i];
    const newLine = newLines[i];
    
    if (oldLine !== newLine) {
      if (hunkStart === -1) hunkStart = i;
      
      if (oldLine !== undefined) {
        hunkLines.push(`-${oldLine}`);
        oldCount++;
      }
      if (newLine !== undefined) {
        hunkLines.push(`+${newLine}`);
        newCount++;
      }
    } else if (hunkStart !== -1) {
      flushHunk();
    }
  }
  
  flushHunk();
  
  return diff;
}

/**
 * 显示diff并允许编辑
 */
export async function showDiffInVsCode(
  originalContent: string,
  newContent: string,
  fileNameHint?: string
): Promise<string | null> {
  const viewer = await getDiffViewer();
  const tempDir = path.join(process.cwd(), '.ai-temp');
  await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
  
  const timestamp = Date.now();
  const baseName = fileNameHint ? path.basename(fileNameHint, path.extname(fileNameHint)) : 'mai';
  const extName = fileNameHint ? path.extname(fileNameHint) : '.tmp';
  
  const originalPath = path.join(tempDir, `${baseName}-original-${timestamp}${extName}`);
  const newPath = path.join(tempDir, `${baseName}-new-${timestamp}${extName}`);
  const patchPath = path.join(tempDir, `${baseName}-${timestamp}.patch`);

  try {
    await fs.writeFile(originalPath, originalContent, 'utf8');
    await fs.writeFile(newPath, newContent, 'utf8');
    
    const patch = generateUnifiedDiff(originalContent, newContent, fileNameHint || 'file');
    await fs.writeFile(patchPath, patch, 'utf8');
    
    await runProcess(viewer, ['--diff', '--wait', originalPath, newPath]);
    
    const editedContent = await fs.readFile(newPath, 'utf8');
    
    if (editedContent !== newContent) {
      console.log(CliStyle.success('检测到并保存了差异审查中的修改。'));
      return editedContent;
    }
    
    console.log(CliStyle.muted('在差异审查中未检测到修改。'));
    return null;
  } catch (error) {
    console.error(CliStyle.error(`打开diff查看器时出错: ${(error as Error).message}`));
    return null;
  } finally {
    await Promise.all([
      fs.unlink(originalPath).catch(() => {}),
      fs.unlink(newPath).catch(() => {}),
      fs.unlink(patchPath).catch(() => {})
    ]);
  }
}

/**
 * 运行外部进程并等待其退出。
 * @param command - 要执行的命令。
 * @param args - 命令的参数数组。
 * @returns 如果进程成功退出，则解析的Promise。
 */
function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });
    childProcess.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`进程以代码 ${code} 退出`));
      }
    });
    childProcess.on('error', (err) => {
      reject(err);
    });
  });
}
