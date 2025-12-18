# MAI - Lightweight File Editing AI CLI

<p>
  <a href="https://www.npmjs.com/package/@johnnren/mai-cli">
    <img src="https://img.shields.io/npm/v/@johnnren/mai-cli.svg" alt="NPM Version">
  </a>
  <a href="https://github.com/john-walks-slow/mai-cli/blob/main/LICENSE">
    <img src="https://img.shields.io/npm/l/@johnnren/mai-cli.svg" alt="License">
  </a>
</p>

MAI (Minimal AI Interface) is a minimalist command-line interface that allows you to invoke large language models to edit local files.

## Examples

```bash
mai "Translate comments to Chinese" *.ts *.tsx
```

```
⠏ Generating AI response... (55s)
✔ AI response generated (56s)

--- Parsing AI Response ---
Parsed 5 delimited operations
Successfully parsed 5 operations.
Saving current AI conversation history...

--- Proposed File Plan ---
Validating operation reachability...
✓ All operations reachable
Edit/Replace: src/types.ts
  Translate English comments in the interface file to Chinese
Edit/Replace: src/store.ts
  Translate English comments in Zustand store to Chinese
Edit/Replace: src/ai.ts
  Translate English comments in the AI wrapper file to Chinese
Edit/Replace: src/Graph.tsx
  Translate English comments in the Graph component to Chinese
Edit/Replace: src/ChatPanel.tsx
  Translate English comments in the chat panel to Chinese
--------------------------

? Select an action: (Use arrow keys)
❯ Apply plan
  Review changes (VS Code diff)
  Export plan (JSON)
  Cancel
```

## Features

- Single-step response, minimalist System Prompt
- Stateless by default, fully manual specification of required context (supports referencing files, glob patterns, operation history)
- Delimiter-based Tool Calling format to avoid JSON escape issues
- Interactive review of file editing plans
- Built-in lightweight operation history (undo, redo)
- Compatible with any openai-compatible model
- Supports defining template files to simplify repetitive tasks

## Installation & Configuration

### 1. Installation

Install globally via npm:

```bash
npm install -g @johnnren/mai-cli
```

### 2. API Key

MAI reads API keys from environment variables by default.

> You can set multiple API keys separated by commas, and MAI will automatically load balance.

```bash
# for OpenAI models
export OPENAI_API_KEY="your_openai_api_key"

# for Google Gemini models
export GEMINI_API_KEY="your_google_api_key"

# for OpenRoutermodels
export OPENROUTER_API_KEY="your_openrouter_api_key"
```

### 3. Configuration File

MAI's configuration file is located at `~/.mai/config.json5`. Default template files are stored in the `~/.mai/templates` directory.

A typical configuration example:

```json5
{
  // Model provider settings
  providers: {
    openrouter: {
      // OpenAI v1 baseUrl
      url: 'https://openrouter.ai/api/v1',
      // Define available models
      models: [
        'x-ai/grok-code-fast-1',
        'qwen/qwen3-coder:free',
        'moonshotai/kimi-k2:free',
        'z-ai/glm-4.5-air:free'
      ],
      // Environment variable name containing the API Key
      apiKeyEnv: 'OPENROUTER_API_KEY',
      // Directly specify API Key (overrides apiKeyEnv)
      apiKey: 'xxxxx'
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/openai/v1',
      models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
      apiKeyEnv: 'GEMINI_API_KEY'
    }
  },
  // Current model, format is provider/model. Can be changed with mai model select.
  model: 'openrouter/x-ai/grok-code-fast-1',
  // Model temperature
  temperature: 0.8,
  // Automatic history context depth
  historyDepth: 0
}
```

## Help

> Use `-h` or `--help` in the command line to view help.

### Main Command

```bash
mai <prompt> [files...] [options]
```

**Parameters:**

- `prompt`:Your instruction.
- `files...`: List of files as context
  - Supports glob patterns, e.g., `"src/**/*.ts"`
  - Supports specifying line ranges, e.g., `"src/index.ts:10-20"`

**Options:**

- `-y, --auto-apply`: Automatically apply the plan without user confirmation (assumes the plan is correct)
- `-r, --ref-history <ids>`: Reference history record IDs, names, or a comma-separated list of indices (e.g., `~1,id2`) as context. `~1` refers to the most recent history.
- `-d, --history-depth <number>`: History depth, automatically loads the N most recent histories (defaults to config or 0)
- `-c, --chat`: Ignore system prompt
- `-a, --auto-context`: (Experimental, not recommended) Enable automatic context preparation, using AI to collect relevant file contexts
- `-m, --model <model>`: Specify the AI model to use, overriding the default configuration
- `-t, --temperature <number>`: Specify the AImodel's temperature parameter, controlling the randomness of the output (0-2)

### Subcommands

#### [`mai history`](src/commands/history.ts)

Manage history records. (~/.mai/history.json)

- `list [-f, --file-only]`: List all available history records. `-f` only shows records containing file operations.
- `undo [id|name|~n]`: Undo changes made by the specified history record without deleting the record. Defaults to the most recent history (`~1`).
- `redo [id|name|~n]`: Reapply changes made by the specified history record without deleting the record. Defaults to the mostrecent history (`~1`).
- `delete <id|name|~n>`: Delete the specified history record.
- `clear`: Clear all history records.

#### [`mai model`](src/commands/model.ts)

Manage and select AI models.

- `list`: List all available AI models and display the currently selected one.
- `select`: Interactively select an AI model.

#### [`mai config`](src/commands/config.tsview configuration items. (~/.mai/config.json5)

- `list`: List current configuration.
- `set <key> <value>`: Directly set a configuration item (e.g., `mai config set model x-ai/grok-code-fast-1`).
- `reset`: Reset all configurations to default values.

#### [`mai template`](src/commands/template.ts)

Manage and apply AI prompt templates. Template files are stored in the `~/.mai/templates` directory, supporting `.txt` or `.md` formats.

- `list`: List all available prompt templates.
- `show <name>`: Display the detailed content ofhe specified prompt template.
- `create <name> [file]`: Create a new prompt template. If `file` is provided, content is copied from that file; otherwise, an empty template is created.
- `edit<name>`: Edit the specified prompt template.
- `delete <name>`: Delete the specified prompt template.
- `apply <name> [files...] [options]`: Apply the specified prompt template and fill placeholders with provided files andinput.
  - `-i, --input <value>`: Value used to fill the `{{user_input}}` placeholder.
  - `-s, --selection <value>`: Value used to fill the `{{selection}}` placeholder.
  - `--set <key=value>`: Set custom placeholder values (can be used multiple times).

#### [`mai exec-plan <planSource>`](src/core/plan-executor.ts)

Execute a given plan from a file path or direct string. Supports JSON and delimited formats.

## Development

```bash
npm link
npm run dev
```

**Update version and publish (automatically triggers Workflow)**

```bash
npm version patch
git push origin --tags
```

## License

MIT
