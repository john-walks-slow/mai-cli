import { z } from 'zod';

// Provider 配置
export const ProviderConfigSchema = z.object({
  url: z.string(),
  models: z.array(z.string()).optional(),
  apiKeyEnv: z.string(),
  apiKey: z.string().optional()
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProvidersConfig = Record<string, ProviderConfig>;

// 配置字段定义类型
type ConfigFieldMeta<T extends z.ZodTypeAny> = {
  schema: T;
  name: string;
  description: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'object';
  default?: z.infer<T>;
  options?: readonly string[];
};

// 配置字段定义
const configFields = {
  model: {
    schema: z.string(),
    name: 'AI 模型',
    description: '选择使用的 AI 模型',
    type: 'select'
  },
  systemPrompt: {
    schema: z.string().optional(),
    name: '系统提示词',
    description: '自定义 AI 的系统提示词，用于定义行为和角色',
    type: 'text'
  },
  historyDepth: {
    schema: z.number().int().min(0).max(50).default(0),
    name: '历史深度',
    description: '自动注入最近 N 条历史记录到提示中 (0-50)',
    type: 'number',
    default: 0
  },
  temperature: {
    schema: z.number().min(0).max(2).default(0.7),
    name: 'Temperature',
    description: 'AI模型的temperature参数，控制输出的随机性 (0-2)',
    type: 'number',
    default: 0.7
  },
  historyScope: {
    schema: z.enum(['global', 'project']).default('global'),
    name: '历史记录范围',
    description: '历史记录存储位置：global (全局) 或 project (项目级别)',
    type: 'select',
    options: ['global', 'project'] as const,
    default: 'global' as const
  },
  diffViewer: {
    schema: z.string().default('code'),
    name: 'Diff查看器',
    description: 'Diff查看器命令 (如 code, vim, meld)',
    type: 'text',
    default: 'code'
  },
  followGitIgnore: {
    schema: z.boolean().default(true),
    name: '跟随 .gitignore',
    description: '是否在 .maiignore 基础上扩展 .gitignore 规则',
    type: 'boolean',
    default: true
  },
  autoContext: {
    schema: z
      .object({
        enabled: z.boolean().default(true),
        maxRounds: z.number().int().min(1).max(100).default(20),
        maxOperations: z.number().int().min(1).max(100).default(40)
      })
      .default({ enabled: true, maxRounds: 20, maxOperations: 40 }),
    name: '自动上下文',
    description: '自动上下文配置（实验性功能，信息收集）',
    type: 'object',
    default: { enabled: true, maxRounds: 20, maxOperations: 40 }
  },
  providers: {
    schema: z.record(z.string(), ProviderConfigSchema),
    name: 'AI 提供商',
    description: '自定义 AI 提供商配置',
    type: 'object'
  }
} as const satisfies Record<string, ConfigFieldMeta<any>>;

// 从 schema 构建 ConfigSchema
export const ConfigSchema = z.object({
  model: configFields.model.schema,
  systemPrompt: configFields.systemPrompt.schema,
  historyDepth: configFields.historyDepth.schema,
  temperature: configFields.temperature.schema,
  historyScope: configFields.historyScope.schema,
  diffViewer: configFields.diffViewer.schema,
  followGitIgnore: configFields.followGitIgnore.schema,
  autoContext: configFields.autoContext.schema,
  providers: configFields.providers.schema
});

export type MaiConfig = z.infer<typeof ConfigSchema>;

// 配置元数据（用于 CLI 显示）
export const CONFIG_METADATA = {
  model: configFields.model,
  systemPrompt: configFields.systemPrompt,
  historyDepth: configFields.historyDepth,
  temperature: configFields.temperature,
  historyScope: configFields.historyScope,
  diffViewer: configFields.diffViewer,
  followGitIgnore: configFields.followGitIgnore,
  'autoContext.enabled': {
    name: '启用自动上下文',
    description: '是否启用自动信息收集',
    type: 'boolean' as const
  },
  'autoContext.maxRounds': {
    name: '最大收集轮次',
    description: 'AI 信息收集的最大轮次 (1-100)',
    type: 'number' as const
  },
  'autoContext.maxOperations': {
    name: '每轮最大操作数',
    description: '每轮信息收集的最大操作数 (1-100)',
    type: 'number' as const
  }
} as const;
