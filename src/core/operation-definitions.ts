import * as fs from 'fs/promises';
import * as path from 'path';
import { findGitRoot } from '../utils/file-utils';
import { isFileIgnored, computeFindMatchCount } from '../utils/file-utils';
import {
  AiOperation,
  OperationType,
  validateOperation,
  validateOperations,
  ValidationResult,
  FileOperation
} from './operation-schema';

const ESCAPE_PREFIX = '\\';

export function startDelimiter(identifier: string = 'OPERATION') {
  return `--- ${identifier} start ---`;
}
export function endDelimiter(identifier: string = 'OPERATION') {
  return `--- ${identifier} end ---`;
}
export const startDelimiterRegex = /^--- ([A-Za-z0-9_]+) start ---$/;
export const endDelimiterRegex = /^--- ([A-Za-z0-9_]+) end ---$/;

export function escapeDelimiters(content: string): string {
  return content
    .replace(/^--- /gm, `${ESCAPE_PREFIX}--- `)
    .replace(/ ---$/gm, ` ---${ESCAPE_PREFIX}`);
}

export function unescapeDelimiters(content: string): string {
  return content
    .replace(new RegExp(`^${ESCAPE_PREFIX}--- `, 'gm'), '--- ')
    .replace(new RegExp(` ---${ESCAPE_PREFIX}$`, 'gm'), ' ---');
}

type FieldConfig = {
  example: string;
  description?: string;
  isBlock?: boolean;
  optional?: boolean;
};

type TypedOperationConfig<T extends OperationType> = {
  description?: string;
  fields: {
    [K in keyof Extract<AiOperation, { type: T }>]: FieldConfig;
  };
};

type OperationConfigs = {
  [K in OperationType]: TypedOperationConfig<K>;
};

/**
 * 动态操作描述生成器 - 基于配置自动生成描述和示例。
 */
export class OperationDescriptions {
  // 集中配置所有操作的元数据
  private static readonly OPERATION_CONFIG: OperationConfigs = {
    response: {
      description: '用于回答问题、解释、提问，不修改文件。支持Markdown。',
      fields: {
        type: { example: 'response' },
        comment: { example: '额外说明', optional: true },
        content: {
          example: '**你的Markdown渲染文本回答。**',
          isBlock: true
        }
      }
    },
    create: {
      description:
        '创建新文件，如果目录不存在，会递归创建目录。禁止用于修改已有文件，覆写已有文件请使用 edit。',
      fields: {
        type: { example: 'create' },
        filePath: {
          example: 'path/to/new_file.jsx'
        },
        comment: { example: '创建一个新的React组件。', optional: true },
        content: {
          example: 'const NewComponent = () => <div>Hello World</div>',
          isBlock: true
        }
      }
    },

    edit: {
      description:
        '编辑现有文件。find 参数留空时覆写整个文件;find 参数给定时,将查找到的目标文本替换为新文本。',
      fields: {
        type: { example: 'edit' },
        filePath: {
          example: 'path/to/file.txt'
        },
        comment: {
          example: '修复了组件中的一个拼写错误。',
          optional: true
        },
        find: {
          example: 'const NewComponent = () => <div>Helo World</div>',
          description: `要查找并替换的目标文本。不支持通配符和正则表达式。请勿包含行号。*必须保证当前文件中有且仅有一个匹配项。*如果留空，则替换整个文件的内容。`,
          optional: true,
          isBlock: true
        },
        content: {
          example: 'const NewComponent = () => <div>Hello World</div>',
          description: '替换为的新内容',
          isBlock: true
        }
      }
    },
    // edit: {
    //   description: "编辑文件内容。如果提供了 startLine 和 endLine，则替换指定行范围内的内容（不包含 endLine）；否则，将用新内容完全覆盖整个文件。\n现在支持对同一文件进行多次 edit 操作。所有 startLine 和 endLine 相对于文件的初始状态。系统会自动跟踪初始行号并调整后续编辑的位置。为确保正确，请按从顶部到底部的顺序提供非重叠的编辑范围。",
    //   fields: {
    //     type: { example: "edit" },
    //     filePath: {
    //       example: "path/to/existing_file.jsx"
    //     },
    //     content: {
    //       description: "要写入的内容",
    //       isContent: true,
    //       example: "const NewComponent = () => <div>Hello World</div>"
    //     },
    //     "startLine": {
    //       description: "修改范围的起始行号（基于原始文件，从 1 开始计数）",
    //       example: "5",
    //       optional: true
    //     },
    //     "endLine": {
    //       description: "修改范围的结束行号（基于原始文件，从 1 开始计数，不包含此行）。指定和 startLine 相同的值可实现插入效果",
    //       example: "6",
    //       optional: true
    //     },
    //     "comment": {
    //       example: "修复了组件中的一个拼写错误。",
    //       optional: true
    //     }
    //   }
    // },
    move: {
      description: '移动现有文件。',
      fields: {
        type: { example: 'move' },
        oldPath: {
          description: '源文件路径',
          example: 'path/to/old.ts'
        },
        newPath: {
          description: '目标文件路径',
          example: 'path/to/new.ts'
        },
        comment: {
          example: '将文件移动到新位置。',
          optional: true
        }
      }
    },
    delete: {
      description: '删除现有文件。',
      fields: {
        type: { example: 'delete' },
        filePath: {
          example: 'path/to/delete.ts'
        },
        comment: {
          example: '删除不再使用的旧文件。',
          optional: true
        }
      }
    }
  } as const;

  /**
   * 生成所有操作的描述文本，用于AI系统提示。
   * @returns 操作描述字符串。
   */
  static getOperationsDescription(): string {
    let description = '';

    for (const [type, config] of Object.entries(this.OPERATION_CONFIG)) {
      const index = Object.keys(this.OPERATION_CONFIG).indexOf(type);
      description += `${index + 1}. ${type}\n`;

      if (config.description) {
        description += `${config.description}\n\n`;
      }

      description += '【参数示例】\n';
      description += `${startDelimiter()}\n`;

      // 遍历操作的字段并生成描述
      for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
        // 1. 生成 JSDoc 风格的注释块
        description += this._buildFieldComment(fieldConfig);

        // 2. 生成字段本身的内容
        if (fieldConfig.isBlock) {
          description += startDelimiter(fieldName);
          description += `\n${fieldConfig.example}\n`;
          description += endDelimiter(fieldName);
        } else {
          description += `${fieldName}: ${fieldConfig.example}`;
        }
        description += '\n';
      }
      description += `${endDelimiter()}\n\n`;
    }

    return description;
  }

  /**
   * 根据字段配置构建一个 JSDoc 风格的注释块。
   * @param fieldConfig - 单个字段的配置对象。
   * @returns 格式化后的 JSDoc 注释字符串，如果无需注释则为空字符串。
   * @private
   */
  private static _buildFieldComment({
    description,
    optional
  }: {
    description?: string;
    optional?: boolean;
  }): string {
    let commentBlock = '';
    if (!description && !optional) {
      return commentBlock;
    }
    // commentBlock += '\n';
    // 构建 JSDoc 注释块
    if (description && description.split('\n').length > 1) {
      commentBlock += '/**\n';
      if (optional) {
        commentBlock += ` * （可选）`;
      }
      for (const line of description.split('\n')) {
        commentBlock += ` * ${line}\n`;
      }
      commentBlock += ' */\n';
    } else {
      commentBlock += `/** ${optional ? '（可选）' : ''}${
        description ?? ''
      } */\n`;
    }

    return commentBlock;
  }
}
