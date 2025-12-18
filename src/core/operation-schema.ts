import { z } from 'zod';

// 统一操作类型定义
export const OperationTypeSchema = z.enum([
  'response',
  'create',
  'edit',
  'move',
  'delete',
  'list_directory',
  'search_content',
  'read_file'
]);

export const BaseOperationSchema = z.object({
  type: OperationTypeSchema,
  comment: z.string().optional()
});

export const ResponseOperationSchema = BaseOperationSchema.extend({
  type: z.literal('response'),
  content: z.string()
});

export const CreateOperationSchema = BaseOperationSchema.extend({
  type: z.literal('create'),
  filePath: z.string().min(1),
  content: z.string()
});

export const EditOperationSchema = BaseOperationSchema.extend({
  type: z.literal('edit'),
  filePath: z.string().min(1),
  find: z.string().optional(),
  content: z.string()
});

export const MoveOperationSchema = BaseOperationSchema.extend({
  type: z.literal('move'),
  oldPath: z.string().min(1),
  newPath: z.string().min(1)
});

export const DeleteOperationSchema = BaseOperationSchema.extend({
  type: z.literal('delete'),
  filePath: z.string().min(1)
});

export const ListDirectoryOperationSchema = BaseOperationSchema.extend({
  type: z.literal('list_directory'),
  path: z.string().min(1),
  recursive: z.boolean().optional(),
  maxDepth: z.number().optional()
});

export const SearchContentOperationSchema = BaseOperationSchema.extend({
  type: z.literal('search_content'),
  path: z.string().min(1),
  pattern: z.string().min(1),
  filePattern: z.string().optional(),
  contextLines: z.number().optional()
});

export const ReadFileOperationSchema = BaseOperationSchema.extend({
  type: z.literal('read_file'),
  path: z.string().min(1),
  start: z.number().optional(),
  end: z.number().optional()
});

export const ContextOperationSchema = z.union([
  ListDirectoryOperationSchema,
  SearchContentOperationSchema,
  ReadFileOperationSchema
]);

export const FileOperationSchema = z.union([
  CreateOperationSchema,
  EditOperationSchema,
  MoveOperationSchema,
  DeleteOperationSchema
]);

export const AiOperationSchema = z.union([
  ResponseOperationSchema,
  ContextOperationSchema,
  FileOperationSchema
]);

export const OperationsArraySchema = z.array(AiOperationSchema);

/**
 * 操作验证结果接口。
 */
export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
}

/**
 * 验证单个操作对象的有效性。
 * @param op - 要验证的操作对象。
 * @returns 验证结果。
 */
export function validateOperation(op: unknown): ValidationResult {
  try {
    AiOperationSchema.parse(op);
    return { isValid: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        isValid: false,
        errors: [error.message]
      };
    }
    return {
      isValid: false,
      errors: [String(error)]
    };
  }
}

/**
 * 验证操作数组的有效性。
 * @param operations - 操作数组。
 * @returns 验证结果。
 */
export function validateOperations(operations: unknown[]): ValidationResult {
  if (!Array.isArray(operations)) {
    return { isValid: false, errors: ['Operations must be an array'] };
  }

  const results = operations
    .map((op, index) => {
      const result = validateOperation(op);
      if (!result.isValid) {
        return {
          index,
          errors: result.errors?.map((e) => `Operation ${index}: ${e}`) || []
        };
      }
      return null;
    })
    .filter(Boolean);

  if (results.length > 0) {
    const errors = results.flatMap((r) => r!.errors);
    return { isValid: false, errors };
  }

  return { isValid: true };
}

// 以下为从 Zod schema 推断的类型

/**
 * 所有支持的操作类型。
 */
export type OperationType = z.infer<typeof OperationTypeSchema>;

/**
 * Response 操作类型
 */
export type ResponseOperation = z.infer<typeof ResponseOperationSchema>;

/**
 * Create 操作类型
 */
export type CreateOperation = z.infer<typeof CreateOperationSchema>;

/**
 * Edit 操作类型
 */
export type EditOperation = z.infer<typeof EditOperationSchema>;

/**
 * Move 操作类型
 */
export type MoveOperation = z.infer<typeof MoveOperationSchema>;

/**
 * Delete 操作类型
 */
export type DeleteOperation = z.infer<typeof DeleteOperationSchema>;

/**
 * ListDirectory 操作类型
 */
export type ListDirectoryOperation = z.infer<
  typeof ListDirectoryOperationSchema
>;

/**
 * SearchContent 操作类型
 */
export type SearchContentOperation = z.infer<
  typeof SearchContentOperationSchema
>;

/**
 * ReadFile 操作类型
 */
export type ReadFileOperation = z.infer<typeof ReadFileOperationSchema>;

/**
 * 信息收集操作的联合类型
 */
export type ContextOperation = z.infer<typeof ContextOperationSchema>;

/**
 * 所有 AI 操作的联合类型
 */
export type AiOperation = z.infer<typeof AiOperationSchema>;

/**
 * 文件操作的联合类型
 */
export type FileOperation = z.infer<typeof FileOperationSchema>;

/**
 * 判断操作是否为信息收集操作
 */
export function isContextOperation(op: AiOperation): op is ContextOperation {
  return (
    op.type === 'list_directory' ||
    op.type === 'search_content' ||
    op.type === 'read_file'
  );
}

/**
 * 判断操作是否为文件操作
 */
export function isFileOperation(op: AiOperation): op is FileOperation {
  return (
    op.type === 'create' ||
    op.type === 'edit' ||
    op.type === 'move' ||
    op.type === 'delete'
  );
}
