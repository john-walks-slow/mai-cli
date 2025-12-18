# MAI - 轻量文件操作 AI CLI

<p>
  <a href="https://www.npmjs.com/package/@johnnren/mai-cli">
    <img src="https://img.shields.io/npm/v/@johnnren/mai-cli.svg" alt="NPM Version">
  </a>
  <a href="https://github.com/john-walks-slow/mai-cli/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/@johnnren/mai-cli.svg" alt="License">
  </a>
</p>

MAI (Minimal AI Interface) 是一个最小化的命令行 AI 工具，允许你调用大语言模型读写本地文件。

与其他更复杂的 AI CLI 不同，MAI **不具备** 自我调用能力，它仅根据给定的提示词和上下文执行 **单步** 文件操作。

## 示例

```bash
mai "翻译注释为中文" *.{ts,tsx}
```

```
⠏ AI流式响应中... (55s)
✔ AI响应成功 (56s)

--- 解析AI响应 ---
解析到 5 个定界操作
正在保存本次AI对话历史...

--- 提议的文件计划 ---
正在验证操作可达性...
✓ 所有操作可达
编辑替换: src/types.ts
  将接口文件中的英文注释翻译为中文
编辑替换: src/store.ts
  将 Zustand store 中的英文注释翻译为中文
编辑替换: src/ai.ts
  将 AI 包装器文件中的英文注释翻译为中文
编辑替换: src/Graph.tsx
  将 Graph 组件中的英文注释翻译为中文
编辑替换: src/ChatPanel.tsx
  将聊天面板中的英文注释翻译为中文
--------------------------

? 选择一个操作: (Use arrow keys)
❯ 应用计划
  审查更改（VS Code diff）
  导出计划 (JSON)
  取消
```

## 特性

- 轻量可控的单步响应
- 默认无状态，手动指定上下文（支持 glob 通配、引用片段、引用操作历史）
- 极简 System Prompt，基于分隔符的 Tool Calling 格式，避免 JSON 转义问题
- 支持交互式审查文件编辑计划
- 内置轻量操作历史（回退、重做）
- 兼容任意 openai-compatible 模型
- 支持自定义提示词模板

## 安装与配置

### 1. 安装

通过 npm 全局安装：

> 确保你已安装 [Node.js](https://nodejs.org/en/download/) 环境

```bash
npm install -g @johnnren/mai-cli
```

### 2. API Key

MAI 默认通过环境变量读取 API keys。

> 你可以设置用逗号分割的多个 API key，MAI 会自动进行负载均衡

```bash
# for OpenAI models
export OPENAI_API_KEY="your_openai_api_key"

# for Google Gemini models
export GEMINI_API_KEY="your_google_api_key"

# for OpenRouter models
export OPENROUTER_API_KEY="your_openrouter_api_key"
```

### 3. 配置文件

MAI 的配置文件位于 `~/.mai/config.json5`。

一个典型的配置示例如下：

```json5
{
  // 模型提供方设置
  providers: {
    openai: {
      // OpenAI v1 baseUrl
      url: 'https://api.openai.com/v1',
      // 定义可用的模型
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
      // 包含 API Key 的环境变量名
      apiKeyEnv: 'OPENAI_API_KEY'
      // 直接指定 API Key（覆盖 apiKeyEnv）
      // apiKey: "xxxxx"
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/v1',
      models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      apiKeyEnv: 'GEMINI_API_KEY'
    },
    openrouter: {
      url: 'https://openrouter.ai/api/v1',
      models: [
        'minimax/minimax-m2:free',
        'qwen/qwen3-coder:free',
        'moonshotai/kimi-k2:free',
        'z-ai/glm-4.5-air:free'
      ],
      apiKeyEnv: 'OPENROUTER_API_KEY'
    },
    siliconflow: {
      url: 'https://api.siliconflow.cn/v1',
      models: ['MiniMaxAI/MiniMax-M2'],
      apiKeyEnv: 'SILICONFLOW_API_KEY'
    }
  },
  // 当前模型，格式为 provider/model。可以用 mai model select 选择
  model: 'openrouter/minimax/minimax-m2:free',
  // 模型温度
  temperature: 0.8,
  // 自动附带的历史上下文深度
  historyDepth: 0
}
```

### 4. 提示词模板

MAI 的提示词模板文件位于 `~/.mai/templates` 目录中，支持 `.txt` 或 `.md` 格式。

MAI 自带 [`helpme`](https://github.com/john-walks-slow/mai-cli/blob/main/resources/templates/helpme.md) 提示词模板，可以作为 AI 自动完成的轻量替代，与支持外部工具调用的编辑器配合使用。

## 使用

> 在命令行中用 `-h` 或 `--help` 查看帮助

### 主命令

```bash
mai <prompt> [files...] [options]
```

**参数:**

- `prompt`: 你的指令。
- `files...`: 作为上下文的文件列表
  - 支持 glob 模式，例如 `"src/**/*.ts"`
  - 支持指定行数范围，例如 `"src/index.ts:10-20"`

**选项:**

- `-y, --auto-apply`: 自动应用计划，无需用户确认（假设计划正确）
- `-r, --ref-history <ids>`: 引用历史记录 ID、名称或索引列表（逗号分隔，如 `~1,id2`）作为上下文。`~1` 代表最近的一次历史
- `-d, --history-depth <number>`: 历史深度，自动加载最近 N 条历史（默认从配置或 0）
- `-c, --chat`: 忽略系统提示词
- `-m, --model <model>`: 指定使用的AI模型，覆盖默认配置
- `-t, --temperature <number>`: 指定AI模型的temperature参数，控制输出的随机性 (0-2)

### 模型选择

#### `mai model`

管理和选择AI模型。

- `list`: 列出所有可用的AI模型，并显示当前选择
- `select`: 交互式选择AI模型

### 历史记录

#### `mai history`

管理和使用历史记录。(~/.mai/history.json)

- `list [-f, --file-only]`: 列出所有可用历史记录。`-f` 只显示包含文件操作的记录
- `undo [id|name|~n]`: 撤销指定的历史记录所做的更改，而不删除该历史记录。默认为最近一次历史（`~1`）
- `redo [id|name|~n]`: 重新应用指定的历史记录所做的更改，而不删除历史记录。默认为最近一次历史（`~1`）
- `delete <id|name|~n>`: 删除指定的历史记录
- `clear`: 清除所有历史记录

### 模板管理

#### `mai template`

管理和应用存储在 ~/.mai/templates/ 目录中的AI提示词模板。

- `list`: 列出所有可用的提示词模板
- `show <name>`: 显示指定提示词模板的详细内容
- `create <name>`: 创建新的提示词模板
- `edit <name>`: 编辑指定的提示词模板
- `delete <name>`: 删除指定的提示词模板
- `apply <name> [files...] [options]`: 应用指定的提示词模板，并用请求参数填充占位符
  - `-i, --input <value>`: 用于填充 `{{user_input}}` 占位符的值
  - `-s, --selection <value>`: 用于填充 `{{selection}}` 占位符的值
  - `--set <key=value>`: 设置自定义占位符值（可多次使用）

### 设置管理

#### `mai config`

管理和查看配置项。(~/.mai/config.json5)

- `list`: 列出当前配置
- `set <key> <value>`: 直接设置配置项（如 `mai config set model gemini/gemini-2.5-flash`）
- `reset`: 重置所有配置到默认值

### 手动执行计划

#### `mai exec-plan <planSource>`

从文件路径或直接字符串执行给定计划。支持 JSON 和定界（delimited）两种格式。

## 开发

```bash
npm link
npm run dev
```

**更新版本号并发布**

```bash
# 提交修改
git commit ...
# 变更版本号
npm version patch
# 先推送修改，此时会触发发布 Workflow
git push origin
# 再推送 tag
git push origin --tags
```

## License

MIT
