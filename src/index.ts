#!/usr/bin/env node

import { Argument, Command, Option } from 'commander';
import * as readline from 'readline';
import * as fs from 'fs/promises';

import { processRequest } from './core/main-processor';
import { executePlanFromSource } from './commands/exec-plan';
import { CliStyle } from './utils/cli-style';
import * as packageJson from '../package.json';
import { listAvailableModels, selectModelInteractive } from './commands/model';
import {
  listConfig,
  resetConfig,
  directSetConfig,
  showConfigOptions
} from './commands/config';
import {
  clearHistory,
  deleteHistory,
  listHistory,
  redoHistory,
  undoHistory
} from './commands/history';
import {
  applyTemplate,
  listTemplates,
  showTemplate,
  createTemplate,
  editTemplate,
  deleteTemplate
} from './commands/template';
import { startDelimiter } from './core/operation-definitions';
import { writeFileContext } from './core/file-context';

const program = new Command();

/**
 * 定义主命令 'mai'。
 */
program
  .name('mai')
  .version(packageJson.version)
  .description('MAI - Minimal File Operation AI')
  .argument('<prompt>', '提示词。')
  .argument(
    '[files...]',
    '作为上下文的文件。支持glob如 "src/**"。支持指定行数范围如 "src/file.ts:10-20"。'
  )
  .option('-y, --auto-apply', '自动应用计划，无需用户确认（假设计划正确）。')
  .option(
    '-r, --ref-history <ids>',
    '引用历史记录 ID、名称或索引列表（逗号分隔，如 ~1,id2）作为上下文。~1 代表最近的一次历史。'
  )
  .option(
    '-d, --history-depth <number>',
    '历史深度，自动加载最近 N 条历史（默认从配置或 0）。'
  )
  .option('-c, --chat', '忽略系统提示词。')
  .addOption(
    new Option(
      '-a, --auto-context',
      '（实验性）启用自动上下文准备，允许 MAI 主动收集需要的文件上下文'
    )
  )
  .option('-m, --model <model>', '指定使用的AI模型，覆盖默认配置。')
  .option(
    '-t, --temperature <number>',
    '指定AI模型的temperature参数，控制输出的随机性 (0-2)。'
  )
  .action(
    async (
      promptArg: string,
      files: string[],
      options: {
        chat?: boolean;
        autoContext?: boolean;
        autoApply?: boolean;
        history?: string;
        historyDepth?: string;
        model?: string;
        temperature?: string;
      }
    ) => {
      let actualPrompt: string;
      let systemToUse: string | undefined = undefined;

      actualPrompt = promptArg;

      // 处理 -c 选项
      if (options.chat) {
        systemToUse = '';
        console.log(CliStyle.info('使用 -c 选项：忽略系统提示词。'));
      }

      try {
        // 解析 historyIds 和 historyDepth
        let historyIds: string[] | undefined;
        let historyDepth: number | undefined;
        if (options.history) {
          historyIds = options.history
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          if (historyIds.length === 0) historyIds = undefined;
        }
        if (options.historyDepth) {
          const depthNum = parseInt(options.historyDepth, 10);
          if (!isNaN(depthNum) && depthNum > 0) {
            historyDepth = depthNum;
          } else {
            console.log(
              CliStyle.warning(
                `无效的历史深度: ${options.historyDepth}，忽略。`
              )
            );
          }
        }

        const autoContext = options.autoContext || false;
        const autoApply = options.autoApply || false;
        const model = options.model;

        // 解析temperature选项
        let temperature: number | undefined;
        if (options.temperature) {
          const tempNum = parseFloat(options.temperature);
          if (!isNaN(tempNum) && tempNum >= 0 && tempNum <= 2) {
            temperature = tempNum;
          } else {
            console.log(
              CliStyle.warning(
                `无效的temperature值: ${options.temperature}，必须在0-2之间，忽略。`
              )
            );
          }
        }

        if (systemToUse !== undefined) {
          await processRequest(
            actualPrompt,
            files,
            historyIds,
            historyDepth,
            systemToUse,
            autoContext,
            autoApply,
            model,
            temperature
          );
        } else {
          await processRequest(
            actualPrompt,
            files,
            historyIds,
            historyDepth,
            undefined,
            autoContext,
            autoApply,
            model,
            temperature
          );
        }
      } catch (error) {
        console.error(
          CliStyle.error(
            `\n发生严重错误: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        );
        process.exit(1);
      }
    }
  );

/**
 * 定义 'exec-plan' 命令，用于执行给定自定义格式的计划。
 */
program
  .command('exec-plan <planSource>')
  .description(
    '从文件路径或直接字符串执行给定计划。支持 JSON 和定界（delimited）两种格式。'
  )
  .action(async (planSource: string, options, command: Command) => {
    const allOptions = command.optsWithGlobals();
    let planContent: string;

    const trimmedSource = planSource.trim();
    // 判断 planSource 是直接的计划内容（定界或JSON）还是文件路径。
    // 如果它以已知格式的起始符开头，则假定是直接内容。
    const isDirectStringContent =
      trimmedSource.startsWith(startDelimiter()) ||
      trimmedSource.startsWith('[') ||
      trimmedSource.startsWith('{');

    if (isDirectStringContent) {
      planContent = planSource;
      console.log(CliStyle.info('正在从直接字符串参数执行计划。'));
    } else {
      // 如果不是直接字符串内容，则假定它是文件路径。
      try {
        planContent = await fs.readFile(planSource, 'utf-8');
        console.log(CliStyle.info(`正在从文件执行计划: ${planSource}`));
      } catch (fileError) {
        // 如果它不是直接字符串内容，并且也不是一个可读文件，那么这是一个错误。
        console.error(
          CliStyle.error(
            `\n错误: 无法将 '${planSource}' 作为文件读取，且它不符合直接 JSON 或定界字符串格式。`
          )
        );
        process.exit(1);
      }
    }

    try {
      const autoApply = allOptions.autoApply || false;
      await executePlanFromSource(
        planContent,
        `手动执行计划来源: ${planSource}`,
        autoApply
      );
    } catch (error) {
      console.error(
        CliStyle.error(
          `\n执行计划失败: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
      process.exit(1);
    }
  });
program
  .command('collect-context [files...]')
  .action((files: string[], options, command) => {
    writeFileContext(files);
  });
/**
 * 定义 'history' 命令，用于版本管理。
 */
program
  .command('history')
  .description('管理和使用历史记录。(~/.mai/history.json)')
  .addCommand(
    new Command('list')
      .description('列出所有可用历史记录。')
      .option('-f, --file-only', '只显示包含文件操作的历史记录。')
      .action(async (options) => {
        await listHistory(options.fileOnly);
      })
  )
  .addCommand(
    new Command('undo')
      .description('撤销指定的历史记录所做的更改，而不删除该历史记录。')
      .addArgument(
        new Argument(
          '[id|name|~n]',
          '历史记录的ID、名称或索引（如 ~1）'
        ).default('~1', '最近一次历史')
      )
      .action(async (idOrName: string) => {
        await undoHistory(idOrName);
      })
  )
  .addCommand(
    new Command('redo')
      .description('重新应用指定的历史记录所做的更改，而不删除历史记录。')
      .addArgument(
        new Argument(
          '[id|name|~n]',
          '历史记录的ID、名称或索引（如 ~1）'
        ).default('~1', '最近一次历史')
      )
      .action(async (idOrName: string) => {
        await redoHistory(idOrName);
      })
  )
  .addCommand(
    new Command('delete')
      .description('删除指定的历史记录。')
      .addArgument(
        new Argument('id|name|~n', '历史记录的ID、名称或索引（如 ~1）')
      )
      .action(async (idOrName: string) => {
        await deleteHistory(idOrName);
      })
  )
  .addCommand(
    new Command('clear').description('清除所有历史记录。').action(async () => {
      await clearHistory();
    })
  );
/**
 * 定义 'template' 命令，用于管理和应用AI提示词模板。
 * 模板存储在 ~/.mai/templates/ 目录中，支持 .txt 和 .md 格式。
 */
program
  .command('template')
  .description(
    `管理和应用存储在 ~/.mai/templates/ 目录中的AI提示词模板。
  
模板文件支持以下占位符:
- {{fileName}}: 文件上下文中第一个文件的文件名 (例如: index.ts)
- {{selection}}: 通过 --selection 提供的当前选中文本
- {{user_input}}: 通过 --input 提供的用户输入
- {{<custom_key>}}: 通过 --set <key=value> 提供的自定义值`
  )
  .addCommand(
    new Command('list')
      .description('列出所有可用的提示词模板。')
      .action(async () => {
        await listTemplates();
      })
  )
  .addCommand(
    new Command('show')
      .argument('<name>', '要显示详情的模板名称。')
      .description('显示指定提示词模板的详细信息。')
      .action(async (name: string) => {
        await showTemplate(name);
      })
  )
  .addCommand(
    new Command('create')
      .argument('<name>', '要创建的模板名称。')
      .option('-f, --format <format>', '模板格式 (txt|md)', 'md')
      .option('-d, --description <description>', '模板描述')
      .description('创建新的提示词模板。')
      .action(
        async (
          name: string,
          options: { format?: string; description?: string }
        ) => {
          const format = (options.format || 'md') as 'txt' | 'md';
          await createTemplate(name, format, options.description);
        }
      )
  )
  .addCommand(
    new Command('edit')
      .argument('<name>', '要编辑的模板名称。')
      .description('编辑指定的提示词模板。')
      .action(async (name: string) => {
        await editTemplate(name);
      })
  )
  .addCommand(
    new Command('delete')
      .argument('<name>', '要删除的模板名称。')
      .description('删除指定的提示词模板。')
      .action(async (name: string) => {
        await deleteTemplate(name);
      })
  )
  .addCommand(
    new Command('apply')
      .argument('<name>', '要应用的模板名称。')
      .argument(
        '[files...]',
        '作为上下文的文件。支持glob如 "src/**"。支持指定行数范围如 "src/file.ts:10-20"。'
      )
      .option('-i, --input <value>', '用于填充 {{user_input}} 占位符的值。')
      .option('-s, --selection <value>', '用于填充 {{selection}} 占位符的值。')
      .option(
        '--set <key=value>',
        '设置自定义占位符值（可多次使用）',
        (value: string, previous: string[] = []) => {
          previous.push(value);
          return previous;
        }
      )
      .description('应用指定的提示词模板，并用请求参数填充占位符。')
      .action(
        async (
          name: string,
          files: string[],
          options: {
            input?: string;
            selection?: string;
            set?: string[];
            autoApply?: boolean;
          },
          command: Command
        ) => {
          const allOptions = command.optsWithGlobals();
          await applyTemplate(name, files, allOptions);
        }
      )
  );

/**
 * 定义 'model' 命令，用于管理和选择AI模型。
 */
program
  .command('model')
  .description('管理和选择AI模型。')
  .addCommand(
    new Command('list')
      .description('列出所有可用的AI模型，并显示当前选择。')
      .action(async () => {
        await listAvailableModels();
      })
  )
  .addCommand(
    new Command('select').description('交互式选择AI模型。').action(async () => {
      await selectModelInteractive();
    })
  );

/**
 * 定义 'config' 命令，用于管理和查看配置。
 */
program
  .command('config')
  .description('管理和查看配置项。(~/.mai/config.json5)')
  .addCommand(
    new Command('list').description('列出当前配置。').action(async () => {
      await listConfig();
    })
  )
  .addCommand(
    new Command('options')
      .description('显示所有可配置选项及其说明。')
      .action(async () => {
        await showConfigOptions();
      })
  )
  .addCommand(
    new Command('set')
      .description(
        '直接设置配置项。使用: mai config set <key> <value> (如 mai config set model google/gemini-2.5-flash)'
      )
      .argument('<key>', '配置键 (如 model, systemPrompt, historyDepth)')
      .argument('<value>', '配置值')
      .description('设置配置项。使用: mai config set <key> <value>')
      .action(async (key: string, value: string) => {
        console.log(CliStyle.info(`设置 ${key} = ${value}`));
        await directSetConfig(key, value);
      })
  )
  .addCommand(
    new Command('init')
      .description('初始化配置文件（创建默认配置）。')
      .action(async () => {
        await resetConfig();
      })
  )
  .addCommand(
    new Command('reset')
      .description('重置所有配置到默认值（同 init）。')
      .action(async () => {
        await resetConfig();
      })
  );

program.parse(process.argv);
