import chalk from 'chalk';

/**
 * 集中所有控制台输出样式、打印和格式化的工具类。
 */
export class CliStyle {
  /**
   * 返回蓝色的信息消息。
   * @param message - 要设置样式的消息。
   */
  static info(message: string): string {
    return chalk.blue(message);
  }

  /**
   * 返回青色的进程消息。
   * @param message - 要设置样式的消息。
   */
  static process(message: string): string {
    return chalk.cyan(message);
  }

  /**
   * 返回黄色的警告消息。
   * @param message - 要设置样式的消息。
   */
  static warning(message: string): string {
    return chalk.yellow(message);
  }

  /**
   * 返回红色的错误消息。
   * @param message - 要设置样式的消息。
   */
  static error(message: string): string {
    return chalk.red(message);
  }

  /**
   * 返回绿色粗体的成功消息。
   * @param message - 要设置样式的消息。
   */
  static success(message: string): string {
    return chalk.green.bold(message);
  }

  /**
   * 返回绿色的用户输入提示消息。
   * @param message - 要设置样式的提示消息。
   */
  static prompt(message: string): string {
    return chalk.green(message);
  }

  /**
   * 返回柔和的灰色消息。
   * @param message - 要设置样式的消息。
   */
  static muted(message: string): string {
    return chalk.gray(message);
  }

  /**
   * 返回灰色的调试消息，带 [DEBUG] 前缀。
   * @param message - 要设置样式的调试消息。
   */
  static debug(message: string): string {
    return chalk.gray(`[DEBUG] ${message}`);
  }

  private static enableDebug =
    process.env.IS_MAI_DEBUG?.toLowerCase() === 'true';

  /**
   * 打印调试消息，如果调试启用。
   * @param message - 调试消息。
   */
  static printDebug(message: string): void {
    if (this.enableDebug) {
      console.log(this.debug(message));
    }
  }

  /**
   * 打印调试内容（使用 muted 样式），如果调试启用。
   * @param content - 内容字符串。
   */
  static printDebugContent(content: string): void {
    if (this.enableDebug) {
      console.log(this.muted(content));
    }
  }

  /**
   * 返回洋红色斜体的思考消息。
   * @param message - 要设置样式的消息。
   */
  static thought(message: string): string {
    return chalk.magenta.italic(message);
  }

  /**
   * 设置操作类型名称的样式（例如：CREATE, EDIT）。
   * @param type - 操作类型字符串。
   */
  static operationType(type: string): string {
    switch (type) {
      case 'create':
        return chalk.green('创建');
      case 'edit':
        return chalk.blue('编辑');
      case 'rename':
        return chalk.magenta('重命名');
      case 'delete':
        return chalk.red('删除');
      default:
        return chalk.white(type.toUpperCase());
    }
  }

  /**
   * 设置文件路径的样式。
   * @param filePath - 文件路径字符串。
   */
  static filePath(filePath: string): string {
    return chalk.yellow(filePath);
  }

  /**
   * 设置注释字符串的样式。
   * @param comment - 注释字符串。
   */
  static comment(comment: string): string {
    return chalk.magenta(comment);
  }

  /**
   * 设置差异块头部的样式。
   * @param line - 差异头部行。
   */
  static diffHeader(line: string): string {
    return chalk.cyan(line);
  }

  /**
   * 设置差异中添加的行的样式。
   * @param line - 添加的行。
   */
  static diffAdded(line: string): string {
    return chalk.green(line);
  }

  /**
   * 设置差异中删除的行的样式。
   * @param line - 删除的行。
   */
  static diffRemoved(line: string): string {
    return chalk.red(line);
  }

  /**
   * 使用chalk进行控制台输出的基本Markdown渲染器。
   * 支持粗体、斜体、行内代码、代码块、标题、水平线、列表和块引用。
   * @param markdownString - 包含Markdown的字符串。
   * @returns 用于控制台输出的ANSI转义字符串。
   */
  static markdown(markdownString: string): string {
    let rendered = markdownString;

    // 代码块 (多行，围栏) - 必须首先处理以防止内部Markdown解析
    rendered = rendered.replace(
      /```(\w+)?\n([\s\S]+?)\n```/g,
      (match, lang, code) => {
        const codeLines = code
          .trim()
          .split('\n')
          .map((line: string) => chalk.bgHex('#333333')(`  ${line}`))
          .join('\n');
        const header = lang
          ? chalk.bgHex('#333333').white(` ${lang} `)
          : chalk.bgHex('#333333').white(' 代码 ');
        return `\n${header}\n${codeLines}\n`;
      }
    );

    // 行内代码 `code`
    rendered = rendered.replace(/`([^`]+?)`/g, (match, code) =>
      chalk.bgHex('#444444').white(code)
    );

    // 粗体 **text** 或 __text__
    rendered = rendered.replace(/(\*\*|__)(.*?)\1/g, (match, p1, text) =>
      chalk.bold(text)
    );

    // 斜体 *text* 或 _text_
    rendered = rendered.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, (match, text) =>
      chalk.italic(text)
    );
    rendered = rendered.replace(/(?<!_)_([^_]+?)_(?!_)/g, (match, text) =>
      chalk.italic(text)
    );

    // 标题 (例如：# Heading, ## Subheading)
    rendered = rendered.replace(/^#\s(.+)$/gm, (match, text) =>
      chalk.cyan.bold(text)
    ); // H1
    rendered = rendered.replace(/^##\s(.+)$/gm, (match, text) =>
      chalk.cyan.underline(text)
    ); // H2
    rendered = rendered.replace(/^###\s(.+)$/gm, (match, text) =>
      chalk.blue.bold(text)
    ); // H3
    rendered = rendered.replace(/^####\s(.+)$/gm, (match, text) =>
      chalk.blue(text)
    ); // H4

    // 水平线 ---
    rendered = rendered.replace(/^-{3,}$/gm, () => chalk.gray('---'));

    // 块引用 > quote
    rendered = rendered.replace(
      /^>\s(.+)$/gm,
      (match, text) => `${chalk.yellow('│ ')}${chalk.yellow.italic(text)}`
    );

    // 列表 (基本无序和有序)
    rendered = rendered.replace(
      /^(\s*[\*\-]\s)(.*)/gm,
      (match, bullet, text) => `${chalk.gray(bullet)}${text}`
    ); // 无序
    rendered = rendered.replace(
      /^(\s*\d+\.\s)(.*)/gm,
      (match, num, text) => `${chalk.gray(num)}${text}`
    ); // 有序

    return rendered;
  }
}
