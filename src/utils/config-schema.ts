import { z } from 'zod';

export const ProviderConfigSchema = z.object({
  url: z.string(),
  models: z.array(z.string()).optional(),
  apiKeyEnv: z.string(),
  apiKey: z.string().optional()
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProvidersConfig = Record<string, ProviderConfig>;

const configFields = {
  model: {
    schema: z.string().optional(),
    name: 'AI 模型',
    description: '选择使用的 AI 模型',
    type: 'select' as const,
    default: 'openai/gpt-4o'
  },
  systemPrompt: {
    schema: z.string().optional(),
    name: '系统提示词',
    description: '自定义 AI 的系统提示词，用于定义行为和角色',
    type: 'text' as const
  },
  historyDepth: {
    schema: z.number().int().min(0).max(50).optional(),
    name: '历史深度',
    description: '自动注入最近 N 条历史记录到提示中 (0-50)',
    type: 'number' as const,
    default: 0
  },
  temperature: {
    schema: z.number().min(0).max(2).optional(),
    name: 'Temperature',
    description: 'AI模型的temperature参数，控制输出的随机性 (0-2)',
    type: 'number' as const,
    default: 0.7
  },
  historyScope: {
    schema: z.enum(['global', 'project']).optional(),
    name: '历史记录范围',
    description: '历史记录存储位置：global (全局) 或 project (项目级别)',
    type: 'select' as const,
    options: ['global', 'project'] as const,
    default: 'global' as const
  },
  diffViewer: {
    schema: z.string().optional(),
    name: 'Diff查看器',
    description: 'Diff查看器命令 (如 code, vim, meld)',
    type: 'text' as const,
    default: 'code'
  },
  followGitIgnore: {
    schema: z.boolean().optional(),
    name: '跟随 .gitignore',
    description: '是否在 .maiignore 基础上扩展 .gitignore 规则',
    type: 'boolean' as const,
    default: true
  },
  autoContext: {
    schema: z
      .object({
        maxRounds: z.number().int().min(1).max(5).optional(),
        maxFiles: z.number().int().min(1).max(20).optional()
      })
      .optional(),
    name: '自动上下文',
    description: '自动上下文配置',
    type: 'object' as const,
    default: { maxRounds: 10, maxFiles: 20 }
  },
  providers: {
    schema: z.record(z.string(), ProviderConfigSchema).optional(),
    name: 'AI 提供商',
    description: '自定义 AI 提供商配置',
    type: 'object' as const
  }
} as const;

export const ConfigSchema = z.object(
  Object.fromEntries(
    Object.entries(configFields).map(([key, field]) => [key, field.schema])
  ) as any
);

export type MaiConfig = z.infer<typeof ConfigSchema>;

export const CONFIG_METADATA = {
  model: configFields.model,
  systemPrompt: configFields.systemPrompt,
  historyDepth: configFields.historyDepth,
  temperature: configFields.temperature,
  historyScope: configFields.historyScope,
  diffViewer: configFields.diffViewer,
  followGitIgnore: configFields.followGitIgnore,
  'autoContext.maxRounds': {
    name: '自动上下文轮次上限',
    description: 'Auto-Context 最大迭代轮次 (1-5)',
    type: 'number' as const
  },
  'autoContext.maxFiles': {
    name: '自动上下文文件上限',
    description: 'Auto-Context 最大文件数量 (1-20)',
    type: 'number' as const
  }
} as const;

export const DEFAULT_CONFIG: Partial<MaiConfig> = Object.fromEntries(
  Object.entries(configFields)
    .filter(([_, field]) => 'default' in field)
    .map(([key, field]) => [key, (field as any).default])
);

export const DEFAULT_PROVIDERS: ProvidersConfig = {
  openai: {
    url: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    apiKeyEnv: 'OPENAI_API_KEY'
  }
};
