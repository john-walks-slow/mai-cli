import inquirer from 'inquirer';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { z } from 'zod';
import JSON5 from 'json5';

import { CliStyle } from '../utils/cli-style';
import {
  loadConfig,
  saveConfig,
  resetConfigCache,
  getCurrentModel,
  parseModel,
  getAvailableModels,
  getConfigValue,
  setConfigValue,
  getNestedConfig,
  setNestedConfig
} from '../config';
import { ConfigSchema, CONFIG_METADATA } from '../config';

export async function showConfigOptions(): Promise<void> {
  try {
    console.log(CliStyle.info('\n--- 可配置选项 ---\n'));
    
    for (const [key, meta] of Object.entries(CONFIG_METADATA)) {
      console.log(CliStyle.success(key));
      console.log(`  名称: ${meta.name}`);
      console.log(`  说明: ${meta.description}`);
      console.log(`  类型: ${meta.type}`);
      
      if ('options' in meta) {
        console.log(`  可选值: ${meta.options.join(', ')}`);
      }
      
      const currentValue = key.includes('.')
        ? await getNestedConfig(key)
        : await getConfigValue(key as any);
      console.log(`  当前值: ${currentValue ?? '(未设置)'}`);
      console.log('');
    }
    
    console.log(CliStyle.info('使用 mai config set <key> <value> 来修改配置\n'));
  } catch (error) {
    console.error(CliStyle.error(`显示配置选项失败: ${(error as Error).message}`));
    process.exit(1);
  }
}

export async function listConfig(): Promise<void> {
  try {
    const currentModel = await getCurrentModel();
    const parsedModel = await parseModel(currentModel);
    const modelDisplay = parsedModel
      ? `${parsedModel.provider} / ${parsedModel.modelName}`
      : currentModel;

    console.log(CliStyle.info('\n--- 当前配置 ---'));
    console.log(`模型: ${CliStyle.success(modelDisplay)}`);
    
    for (const [key, meta] of Object.entries(CONFIG_METADATA)) {
      if (key === 'model') continue;
      const value = key.includes('.')
        ? await getNestedConfig(key)
        : await getConfigValue(key as any);
      if (value !== undefined) {
        console.log(`${meta.name}: ${value}`);
      }
    }

    console.log(CliStyle.info(`\n配置文件: ${path.join(os.homedir(), '.mai/config.json5')}`));
    console.log(CliStyle.info('--------------------------\n'));
  } catch (error) {
    console.error(CliStyle.error(`列出配置失败: ${(error as Error).message}`));
    process.exit(1);
  }
}

/**
 * 设置配置项。
 */

/**
 * 重置配置到默认值。
 */
export async function resetConfig(): Promise<void> {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: '这将重置所有配置到默认值，确定要继续吗？',
      default: false
    }
  ]);

  if (!confirm) {
    console.log(CliStyle.info('已取消重置。'));
    return;
  }

  try {
    const defaultConfigPath = path.join(__dirname, '../../resources/config.json5');
    const content = await fs.readFile(defaultConfigPath, 'utf-8');
    const defaultConfig = JSON5.parse(content);
    await saveConfig(defaultConfig);
    resetConfigCache();
    console.log(CliStyle.success('配置已重置到默认值。'));
  } catch (error) {
    console.error(CliStyle.error(`重置配置失败: ${(error as Error).message}`));
  }
}

/**
 * 直接设置配置项（非交互式）。
 * @param key - 配置键，如 'model', 'systemPrompt', 'historyDepth'
 * @param value - 配置值字符串，将根据类型转换
 */
export async function directSetConfig(key: string, value: string): Promise<void> {
  try {
    const meta = CONFIG_METADATA[key as keyof typeof CONFIG_METADATA];
    if (!meta) {
      throw new Error(`不支持的配置键: ${key}`);
    }

    let convertedValue: any = value;

    if (meta.type === 'number') {
      convertedValue = Number(value);
      if (isNaN(convertedValue)) {
        throw new Error(`无效的数字值: ${value}`);
      }
    } else if (meta.type === 'boolean') {
      convertedValue = value === 'true';
    } else if (meta.type === 'select' && 'options' in meta) {
      if (!meta.options.includes(value as any)) {
        throw new Error(`无效值，可选: ${meta.options.join(', ')}`);
      }
    }

    // 验证配置
    const testConfig = await loadConfig();
    if (key.includes('.')) {
      const keys = key.split('.');
      let target: any = testConfig;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) target[keys[i]] = {};
        target = target[keys[i]];
      }
      target[keys[keys.length - 1]] = convertedValue;
    } else {
      (testConfig as any)[key] = convertedValue;
    }
    
    ConfigSchema.parse(testConfig);

    if (key.includes('.')) {
      await setNestedConfig(key, convertedValue);
    } else {
      await setConfigValue(key as any, convertedValue);
    }

    console.log(CliStyle.success(`${key} 已设置为: ${convertedValue}`));
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(CliStyle.error(`验证失败: ${error.issues[0].message}`));
    } else {
      console.error(CliStyle.error(`设置失败: ${(error as Error).message}`));
    }
    process.exit(1);
  }
}
