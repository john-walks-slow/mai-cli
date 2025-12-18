import * as readline from 'readline';
import { CliStyle } from '../utils/cli-style';
import {
  getAvailableModels,
  getCurrentModel,
  setModel,
  hasApiKey,
  getApiKey
} from '../config';

/**
 * 列出所有可用的 AI 模型。
 */
export const listAvailableModels = async (): Promise<void> => {
  const current = await getCurrentModel();
  const models = await getAvailableModels();

  // 并行获取每个模型的密钥状态及缺失的环境变量名
  const keyMarkers = await Promise.all(
    models.map(async (model) => {
      const hasKey = await hasApiKey(model);
      if (hasKey) return '';
      try {
        // 这里会抛出错误，错误信息中包含缺失的 env var
        await getApiKey(model);
        return '';
      } catch (e) {
        const msg = (e as Error).message;
        const match = msg.match(/Set (\w+)/);
        const envVar = match ? match[1] : 'API_KEY';
        return CliStyle.warning(` [缺少 ${envVar}]`);
      }
    })
  );

  console.log(CliStyle.info('可用模型:'));
  models.forEach((model, index) => {
    const marker = model === current ? CliStyle.success(' [当前]') : '';
    const keyMarker = keyMarkers[index];
    console.log(`${index + 1}. ${model}${marker}${keyMarker}`);
  });
};

/**
 * 交互式选择 AI 模型。
 */
export const selectModelInteractive = async (): Promise<void> => {
  // 列出所有模型（包括缺少 API Key 的模型，已标记）
  await listAvailableModels();

  const models = await getAvailableModels();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      CliStyle.prompt(`请选择模型编号 (1-${models.length}): `),
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });

  const choice = parseInt(answer, 10);
  if (isNaN(choice) || choice < 1 || choice > models.length) {
    console.log(CliStyle.error('无效选择。退出。'));
    return;
  }

  const selectedModel = models[choice - 1];

  // 检查所选模型是否拥有 API Key
  if (!(await hasApiKey(selectedModel))) {
    let missingEnv = '';
    try {
      await getApiKey(selectedModel);
    } catch (e) {
      const msg = (e as Error).message;
      const match = msg.match(/Set (\w+)/);
      missingEnv = match ? match[1] : '';
    }
    const hint = missingEnv ? `缺少环境变量 ${missingEnv}` : '缺少 API Key';
    console.log(
      CliStyle.error(`模型 '${selectedModel}' ${hint}，无法使用。请先配置。`)
    );
    return;
  }

  await setModel(selectedModel);
  console.log(CliStyle.success(`模型已设置为: ${selectedModel}`));
};
