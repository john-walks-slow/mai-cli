import * as fs from 'fs/promises';
import * as path from 'path';
import { getMaiConfigDir } from '../config';
import { CliStyle } from './cli-style';

/**
 * 文件系统中的模板信息接口
 */
export interface FileTemplate {
  name: string; // 模板名称（从文件名提取）
  fileName: string; // 实际文件名
  description?: string; // 模板描述（从文件内容第一行的注释提取）
  template: string; // 模板内容
  format: 'txt' | 'md'; // 文件格式
  filePath: string; // 完整文件路径
  lastModified: Date; // 最后修改时间
}

/**
 * 模板管理器类，负责文件系统中的模板管理
 */
export class TemplateManager {
  private static TEMPLATES_DIR = 'templates';

  /**
   * 获取模板目录路径
   */
  static async getTemplatesDir(): Promise<string> {
    const configDir = getMaiConfigDir();
    return path.join(configDir, this.TEMPLATES_DIR);
  }

  /**
   * 确保模板目录存在
   */
  static async ensureTemplatesDir(): Promise<string> {
    const templatesDir = await this.getTemplatesDir();
    await fs.mkdir(templatesDir, { recursive: true });
    return templatesDir;
  }

  /**
   * 列出所有可用的模板
   */
  static async listTemplates(): Promise<FileTemplate[]> {
    try {
      const templatesDir = await this.ensureTemplatesDir();
      const files = await fs.readdir(templatesDir);

      const templates: FileTemplate[] = [];

      for (const file of files) {
        const filePath = path.join(templatesDir, file);
        const stat = await fs.stat(filePath);

        // 只处理.txt和.md文件
        if (stat.isFile() && (file.endsWith('.txt') || file.endsWith('.md'))) {
          const template = await this.readTemplateFile(filePath, file);
          if (template) {
            templates.push(template);
          }
        }
      }

      return templates.sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 模板目录不存在，返回空数组
        return [];
      }
      throw new Error(`列出模板失败: ${(error as Error).message}`);
    }
  }

  /**
   * 根据名称获取模板
   */
  static async getTemplate(templateName: string): Promise<FileTemplate | null> {
    const templates = await this.listTemplates();
    return templates.find((t) => t.name === templateName) || null;
  }

  /**
   * 读取模板文件
   */
  static async readTemplateFile(
    filePath: string,
    fileName: string
  ): Promise<FileTemplate | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const extension = path.extname(fileName).slice(1) as 'txt' | 'md';
      const name = path.basename(fileName, path.extname(fileName));

      // 解析描述信息（从文件开头的注释中提取）
      const description = this.extractDescription(content);

      return {
        name,
        fileName,
        description,
        template: content,
        format: extension,
        filePath,
        lastModified: await fs.stat(filePath).then((stat) => stat.mtime)
      };
    } catch (error) {
      console.warn(
        CliStyle.warning(
          `读取模板文件失败: ${filePath} - ${(error as Error).message}`
        )
      );
      return null;
    }
  }

  /**
   * 从文件内容中提取描述信息
   * 支持以下格式：
   * 1. <!-- 描述: 这是描述 -->
   * 2. <!-- description: 这是描述 -->
   * 3. // 描述: 这是描述
   * 4. 第一行如果是注释，则作为描述
   */
  static extractDescription(content: string): string | undefined {
    const lines = content.split('\n').map((line) => line.trim());

    // 尝试多种描述格式
    for (const line of lines.slice(0, 3)) {
      // 只检查前3行
      // HTML注释格式
      let match = line.match(/<!--\s*(?:描述|description):\s*(.+?)\s*-->/i);
      if (match) return match[1];

      // 单行注释格式
      match = line.match(/(?:\/\/|#)\s*(?:描述|description):\s*(.+?)\s*$/i);
      if (match) return match[1];

      // 如果第一行是注释，则作为描述
      if (line.match(/^(<!--|\/\/|#)/)) {
        const desc = line
          .replace(/^(<!--|\/\/|#)\s*/, '')
          .replace(/-->$/, '')
          .trim();
        if (desc && !desc.toLowerCase().includes('description')) {
          return desc;
        }
      }
    }

    return undefined;
  }

  /**
   * 创建新模板
   */
  static async createTemplate(
    name: string,
    content: string,
    format: 'txt' | 'md' = 'md',
    description?: string
  ): Promise<void> {
    const templatesDir = await this.ensureTemplatesDir();
    const fileName = `${name}.${format}`;
    const filePath = path.join(templatesDir, fileName);

    // 检查文件是否已存在
    try {
      await fs.access(filePath);
      throw new Error(`模板 '${name}' 已存在`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    // 如果提供了描述，添加到文件开头
    let finalContent = content;
    if (description) {
      if (format === 'md') {
        finalContent = `<!-- 描述: ${description} -->\n\n${content}`;
      } else {
        finalContent = `// 描述: ${description}\n\n${content}`;
      }
    }

    await fs.writeFile(filePath, finalContent, 'utf-8');
    console.log(CliStyle.success(`模板 '${name}' 创建成功`));
  }

  /**
   * 更新模板
   */
  static async updateTemplate(
    name: string,
    content: string,
    description?: string
  ): Promise<void> {
    const template = await this.getTemplate(name);
    if (!template) {
      throw new Error(`模板 '${name}' 不存在`);
    }

    // 检查文件是否被修改
    const currentStat = await fs.stat(template.filePath);
    if (currentStat.mtime > template.lastModified) {
      throw new Error(`模板 '${name}' 文件已被外部修改，请先同步或强制更新`);
    }

    let finalContent = content;
    if (description !== undefined) {
      // 移除现有的描述部分
      const lines = content.split('\n');
      const contentStartIndex = this.findContentStartIndex(
        lines,
        template.format
      );
      const actualContent = lines.slice(contentStartIndex).join('\n');

      if (description) {
        if (template.format === 'md') {
          finalContent = `<!-- 描述: ${description} -->\n\n${actualContent}`;
        } else {
          finalContent = `// 描述: ${description}\n\n${actualContent}`;
        }
      } else {
        finalContent = actualContent;
      }
    }

    await fs.writeFile(template.filePath, finalContent, 'utf-8');
    console.log(CliStyle.success(`模板 '${name}' 更新成功`));
  }

  /**
   * 删除模板
   */
  static async deleteTemplate(name: string): Promise<void> {
    const template = await this.getTemplate(name);
    if (!template) {
      throw new Error(`模板 '${name}' 不存在`);
    }

    await fs.unlink(template.filePath);
    console.log(CliStyle.success(`模板 '${name}' 删除成功`));
  }

  /**
   * 查找内容开始行索引（跳过描述部分）
   */
  private static findContentStartIndex(
    lines: string[],
    format: 'txt' | 'md'
  ): number {
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // 检查是否是描述行
      const isDescription =
        line.match(/^<!--\s*(?:描述|description):/i) ||
        line.match(/^(?:\/\/|#)\s*(?:描述|description):/i) ||
        line.match(/^(<!--|\/\/|#)\s*$/);

      if (!isDescription) {
        return i;
      }
    }
    return 0;
  }

  /**
   * 验证模板名称
   */
  static isValidTemplateName(name: string): boolean {
    // 模板名称不能包含路径分隔符或特殊字符
    const invalidChars = /[<>:"/\\|?*]/;
    return !invalidChars.test(name) && name.length > 0 && name.length <= 50;
  }
}
