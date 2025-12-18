#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAI_CONFIG_DIR = path.join(os.homedir(), '.mai');
const CONFIG_FILE = path.join(MAI_CONFIG_DIR, 'config.json5');

const packageRoot = path.resolve(__dirname, '..');
const defaultConfigPath = path.join(packageRoot, 'resources', 'config.json5');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resetConfig() {
  console.log('重置 MAI 配置...');

  try {
    ensureDir(MAI_CONFIG_DIR);

    if (fs.existsSync(defaultConfigPath)) {
      fs.copyFileSync(defaultConfigPath, CONFIG_FILE);
      console.log('✅ 配置已重置为默认值');
      console.log(`📁 配置文件: ${CONFIG_FILE}`);
    } else {
      console.error('❌ 默认配置文件不存在');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ 重置配置失败:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  resetConfig();
}

module.exports = { resetConfig };