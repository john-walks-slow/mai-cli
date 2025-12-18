import * as fs from 'fs/promises';
import * as path from 'path';
import {
  AiOperation,
  OperationType,
  validateOperation,
  validateOperations,
  ValidationResult,
  FileOperation
} from './operation-schema';
import { isFileIgnored, computeFindMatchCount } from '../utils/file-utils';
import { findGitRoot } from '../utils/file-utils';

/**
 * 使用 Zod 的简化操作验证工具。
 */
export class OperationValidator {
  /**
   * 验证单个操作对象的有效性。
   * @param op - 要验证的操作对象。
   * @returns 验证结果。
   */
  static validateOperation(op: unknown): ValidationResult {
    return validateOperation(op);
  }

  /**
   * 验证操作数组。
   * @param operations - 操作数组。
   * @returns 验证结果。
   */
  static validateOperations(operations: unknown[]): ValidationResult {
    return validateOperations(operations);
  }

  /**
   * 验证操作的可达性（文件系统检查）。
   * @param op - 要验证的操作对象。
   * @returns 验证结果。
   */
  static async validateOperationReachability(
    op: FileOperation
  ): Promise<ValidationResult> {
    try {
      switch (op.type) {
        case 'create':
          return await this.validateCreateReachability(op);
      case 'edit':
        return await this.validateEditReachability(op);
        case 'move':
          return await this.validateMoveReachability(op);
        case 'delete':
          return await this.validateDeleteReachability(op);
        default:
          return {
            isValid: false,
            errors: [`未知操作类型: ${(op as any).type}`]
          };
      }
    } catch (error) {
      return {
        isValid: false,
        errors: [
          `验证可达性时出错: ${
            error instanceof Error ? error.message : String(error)
          }`
        ]
      };
    }
  }

  /**
   * 验证操作数组的可达性。
   * @param operations - 文件操作数组。
   * @returns 验证结果。
   */
  static async validateOperationsReachability(
    operations: FileOperation[]
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      const result = await this.validateOperationReachability(op);
      if (!result.isValid) {
        result.errors?.forEach((error) => {
          errors.push(`操作 ${i + 1} (${op.type}): ${error}`);
        });
      }
    }

    if (errors.length > 0) {
      return { isValid: false, errors };
    }

    return { isValid: true };
  }

  /**
   * 验证创建操作的可达性。
   */
  private static async validateCreateReachability(
    op: FileOperation
  ): Promise<ValidationResult> {
    const filePath = (op as any).filePath;
    if (!filePath) {
      return { isValid: false, errors: ['创建操作缺少文件路径'] };
    }

    // 检查文件是否已存在
    try {
      await fs.access(filePath);
      return { isValid: false, errors: [`文件已存在: ${filePath}`] };
    } catch {
      // 文件不存在，这是期望的
    }

    return { isValid: true };
  }

  /**
   * 验证编辑操作的可达性。
   */
  private static async validateEditReachability(
    op: FileOperation
  ): Promise<ValidationResult> {
    const filePath = (op as any).filePath;
    if (!filePath) {
      return { isValid: false, errors: ['替换操作缺少文件路径'] };
    }

    try {
      const root = await findGitRoot();
      const relativePath = path.relative(root, filePath);
        if (await isFileIgnored(relativePath)) {
          return {
            isValid: false,
            errors: ['文件被忽略,无法执行编辑操作']
          };
        }

      // 检查文件是否存在
      await fs.access(filePath);

      // 如果提供了find参数，验证它在文件中是否存在
      const find = (op as any).find;
      if (find) {
        const content = await fs.readFile(filePath, 'utf-8');
        const findCount = computeFindMatchCount(content, find);
        if (findCount === 0) {
          return {
            isValid: false,
            errors: [`在文件中找不到要替换的文本: ${filePath}\n${find}\n`]
          };
        } else if (findCount > 1) {
          return {
            isValid: false,
            errors: [
              `在文件中找到多个匹配项 (${findCount}个)，需要更具体的查找文本: ${filePath}`
            ]
          };
        }
      }

      return { isValid: true };
    } catch (error) {
      return { isValid: false, errors: [`无法访问文件: ${filePath}`] };
    }
  }

  /**
   * 验证移动操作的可达性。
   */
  private static async validateMoveReachability(
    op: FileOperation
  ): Promise<ValidationResult> {
    const oldPath = (op as any).oldPath;
    const newPath = (op as any).newPath;

    if (!oldPath || !newPath) {
      return { isValid: false, errors: ['移动操作缺少源路径或目标路径'] };
    }

    try {
      // 检查源文件是否存在
      await fs.access(oldPath);

      // 检查目标路径是否可用
      const newDir = path.dirname(newPath);
      await fs.access(newDir);

      // 检查目标文件是否已存在
      try {
        await fs.access(newPath);
        return { isValid: false, errors: [`目标文件已存在: ${newPath}`] };
      } catch {
        // 目标文件不存在，这是期望的
      }

      return { isValid: true };
    } catch (error) {
      if (error instanceof Error && error.message.includes('源文件')) {
        return { isValid: false, errors: [`源文件不存在: ${oldPath}`] };
      }
      return {
        isValid: false,
        errors: [`无法访问目标目录: ${path.dirname(newPath)}`]
      };
    }
  }

  /**
   * 验证删除操作的可达性。
   */
  private static async validateDeleteReachability(
    op: FileOperation
  ): Promise<ValidationResult> {
    const filePath = (op as any).filePath;
    if (!filePath) {
      return { isValid: false, errors: ['删除操作缺少文件路径'] };
    }

    try {
      // 检查文件是否存在
      await fs.access(filePath);
      return { isValid: true };
    } catch (error) {
      return { isValid: false, errors: [`文件不存在: ${filePath}`] };
    }
  }
}
