import inquirer from 'inquirer';
import * as os from 'os';
import * as path from 'path';

import { CliStyle } from '../utils/cli-style';
import {
  ConfigOption,
  getAvailableModels,
  getConfigurableOptions,
  getCurrentModel,
  getHistoryDepth,
  getSystemPrompt,
  getTemperature,
  loadConfig,
  parseModel,
  resetConfigCache,
  saveConfig,
  setModel,
  setSystemPrompt
} from '../utils/config-manager';

/**
 * 列出当前配置。
 */
export async function listConfig(): Promise<void> {
  try {
    const config = await loadConfig();
    const currentModel = await getCurrentModel();
    const systemPrompt = await getSystemPrompt();
    const historyDepth = await getHistoryDepth();
    const temperature = await getTemperature();
    const { getHistoryScope } = await import('../utils/config-manager');
    const historyScope = await getHistoryScope();

    const parsedModel = await parseModel(currentModel);
    const modelDisplay = parsedModel
      ? `${parsedModel.provider} / ${parsedModel.modelName}`
      : currentModel;

    console.log(CliStyle.info('\n--- 当前配置 ---'));

    console.log(`模型: ${CliStyle.success(modelDisplay)}`);
    console.log(`历史深度: ${historyDepth ?? '0 (默认)'}`);
    console.log(`历史记录范围: ${historyScope}`);
    console.log(`Temperature: ${temperature}`);

    if (systemPrompt) {
      console.log(
        `系统提示词: ${CliStyle.muted('(已配置，长度: ' + systemPrompt.length + ' 字符)')}`
      );
    } else {
      console.log(`系统提示词: ${CliStyle.warning('使用默认')}`);
    }

    console.log(
      CliStyle.info(
        `配置文件位置: ${path.join(os.homedir(), '.mai/config.json5')}`
      )
    );
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
    // 创建空的配置对象，这将有效地清除所有自定义配置
    const defaultConfig = {};
    await saveConfig(defaultConfig);
    // 清除内存中的配置缓存
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
export async function directSetConfig(
  key: string,
  value: string
): Promise<void> {
  try {
    const options = await getConfigurableOptions();
    const option = options.find((o: ConfigOption) => o.key === key);

    if (!option) {
      throw new Error(
        `不支持的配置键: ${key}。可用键: ${options.map((o) => o.key).join(', ')}`
      );
    }

    let convertedValue: any = value;

    // 根据类型转换值
    if (option.type === 'number') {
      const num = Number(value);
      if (isNaN(num)) {
        throw new Error(`无效的数字值 for ${key}: ${value}`);
      }
      if (option.min !== undefined && num < option.min) {
        throw new Error(`值 ${num} 小于最小值 ${option.min}`);
      }
      if (option.max !== undefined && num > option.max) {
        throw new Error(`值 ${num} 大于最大值 ${option.max}`);
      }
      convertedValue = num;
    } else if (option.type === 'select') {
      if (option.options && !option.options.includes(value)) {
        throw new Error(
          `无效的选择值 for ${key}: ${value}。可用选项: ${option.options.join(', ')}`
        );
      }
    } // text 类型直接用字符串

    await option.setter(convertedValue);
    console.log(CliStyle.success(`${key} 已设置为: ${convertedValue}`));
  } catch (error) {
    console.error(
      CliStyle.error(`设置 ${key} 失败: ${(error as Error).message}`)
    );
    process.exit(1);
  }
}
