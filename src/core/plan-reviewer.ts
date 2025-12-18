import * as fs from 'fs/promises';
import * as path from 'path';
import inquirer from 'inquirer';
import ora from 'ora';

import { CliStyle } from '../utils/cli-style';
import { openInEditor, showDiffInVsCode } from '../utils/editor-utils';
import { executePlan } from './plan-executor';
import { autoFixOperations } from './plan-fixer';
import { replaceInFile } from '../utils/file-utils';
import { FileOperation } from './operation-schema';
import { OperationValidator } from './operation-validator';

/**
 * 向控制台显示提议的文件操作摘要。
 * @param operations - 要显示的文件操作列表。
 */
export async function displayPlan(operations: FileOperation[]): Promise<void> {
  console.log(CliStyle.warning('\n--- 提议的文件计划 ---'));
  if (operations.length === 0) {
    console.log(CliStyle.muted('未提议文件操作。'));
    console.log(CliStyle.warning('--------------------------\n'));
    return;
  }

  // 使用 Zod 验证操作列表
  const validation = OperationValidator.validateOperations(operations);
  if (!validation.isValid) {
    console.log(CliStyle.error('警告: 发现无效操作，将跳过显示。'));
    console.log(
      CliStyle.muted(`错误: ${validation.errors?.join(', ') || '未知验证错误'}`)
    );
    return;
  }

  // 验证操作的可达性
  console.log(CliStyle.info('正在验证操作可达性...'));
  const reachabilityValidation =
    await OperationValidator.validateOperationsReachability(operations);
  if (!reachabilityValidation.isValid) {
    console.log(CliStyle.warning('警告: 发现不可达操作，但将继续显示计划。'));
    reachabilityValidation.errors?.forEach((error) => {
      console.log(CliStyle.warning(`  ${error}`));
    });
  } else {
    console.log(CliStyle.success('✓ 所有操作可达'));
  }

  operations.forEach((op) => {
    const typeStyled = CliStyle.operationType(op.type);
    let line = `${typeStyled}: `;
    let commentAndThought = '';

    if (op.comment) {
      commentAndThought += CliStyle.comment(op.comment);
    }
    switch (op.type) {
      case 'create':
      case 'writeWithReplace':
        line += CliStyle.filePath(op.filePath);
        break;
      case 'delete':
        line += CliStyle.filePath(op.filePath);
        break;
      case 'move':
        line += `${CliStyle.filePath(op.oldPath)} -> ${CliStyle.filePath(op.newPath)}`;
        break;
      default:
        line = `${CliStyle.warning('未知')}: ${JSON.stringify(op)}`;
        break;
    }

    console.log(
      `${line}${commentAndThought ? `\n   ${commentAndThought}` : ''}`
    );
  });
  console.log(CliStyle.warning('--------------------------\n'));
}

/**
 * 使用差异查看器（VS Code）详细审查创建和编辑操作，并允许用户在审查时修改内容。
 * @param operations - 要审查的文件操作列表。
 * @returns 修改后的操作数组。
 */
async function reviewChangesInDetail(
  operations: FileOperation[]
): Promise<FileOperation[]> {
  console.log(CliStyle.process('\n--- 正在审查文件内容更改 ---'));

  // 使用 Zod 验证操作
  const validation = OperationValidator.validateOperations(operations);
  if (!validation.isValid) {
    console.log(CliStyle.error('操作验证失败，无法进行详细审查。'));
    console.log(
      CliStyle.muted(`错误: ${validation.errors?.join(', ') || '未知验证错误'}`)
    );
    return operations;
  }

  const reviewedOperations: FileOperation[] = [];

  for (const op of operations) {
    if (op.type === 'create') {
      let originalContentForDiff = '';
      let ignoreLineRange = false;
      console.log(
        CliStyle.info(`\n正在显示创建内容: ${CliStyle.filePath(op.filePath)}`)
      );
      originalContentForDiff = '';

      let fullNewContent = op.content;

      try {
        const editedContent = await showDiffInVsCode(
          originalContentForDiff,
          fullNewContent,
          op.filePath
        );

        if (editedContent !== null) {
          // 用户修改并保存了内容
          const updatedOp = { ...op, content: editedContent } as FileOperation;
          // Since edited full, remove line range
          delete (updatedOp as any).startLine;
          delete (updatedOp as any).endLine;

          // 验证修改后的操作
          const updatedValidation =
            OperationValidator.validateOperation(updatedOp);
          if (!updatedValidation.isValid) {
            console.log(
              CliStyle.warning(
                `警告: 修改后的操作验证失败: ${updatedValidation.errors?.join(', ') || '未知错误'}`
              )
            );
            reviewedOperations.push(op); // 如果验证失败，保留原始操作
          } else {
            console.log(
              CliStyle.success(
                `已更新 ${CliStyle.filePath(op.filePath)} 的计划内容。`
              )
            );
            reviewedOperations.push(updatedOp);
          }
        } else if (editedContent === null && originalContentForDiff !== '') {
          // Edit 操作，用户未修改
          reviewedOperations.push(op);
        } else if (editedContent === null && originalContentForDiff === '') {
          // Create 操作，用户可能取消了
          console.log(
            CliStyle.muted(`跳过创建 ${CliStyle.filePath(op.filePath)}。`)
          );
          // 不添加到 reviewedOperations，相当于移除
        }
      } catch (error) {
        console.log(
          CliStyle.warning(
            `审查 ${CliStyle.filePath(op.filePath)} 时出错: ${(error as Error).message}`
          )
        );
        reviewedOperations.push(op); // 发生错误时保留原始操作
      }
    } else if (op.type === 'writeWithReplace') {
      console.log(
        CliStyle.info(`\n正在显示替换内容: ${CliStyle.filePath(op.filePath)}`)
      );

      try {
        // 读取文件的当前内容
        const originalContent = await fs.readFile(op.filePath, 'utf-8');
        const fullNewContent = replaceInFile(
          originalContent,
          op.content,
          op.find
        );

        const editedContent = await showDiffInVsCode(
          originalContent,
          fullNewContent,
          op.filePath
        );

        if (editedContent !== null) {
          // 用户修改并保存了内容
          const updatedOp = { ...op, content: editedContent } as FileOperation;
          // 移除 find，因为编辑后可能不再是替换操作
          delete (updatedOp as any).find;

          // 验证修改后的操作
          const updatedValidation =
            OperationValidator.validateOperation(updatedOp);
          if (!updatedValidation.isValid) {
            console.log(
              CliStyle.warning(
                `警告: 修改后的操作验证失败: ${updatedValidation.errors?.join(', ') || '未知错误'}`
              )
            );
            reviewedOperations.push(op); // 如果验证失败，保留原始操作
          } else {
            console.log(
              CliStyle.success(
                `已更新 ${CliStyle.filePath(op.filePath)} 的计划内容。`
              )
            );
            reviewedOperations.push(updatedOp);
          }
        } else {
          // 用户未修改或取消
          reviewedOperations.push(op);
        }
      } catch (error) {
        console.log(
          CliStyle.warning(
            `审查 ${CliStyle.filePath(op.filePath)} 时出错: ${(error as Error).message}`
          )
        );
        reviewedOperations.push(op); // 发生错误时保留原始操作
      }
    } else {
      reviewedOperations.push(op); // 非创建/编辑操作直接添加
    }
  }
  console.log(CliStyle.process('--- 审查结束 ---\n'));
  return reviewedOperations;
}

/**
 * 将计划导出为 JSON 文件。
 * @param operations - 当前文件操作列表。
 */
async function exportPlanToJson(operations: FileOperation[]): Promise<void> {
  try {
    const { fileName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'fileName',
        message: '请输入导出文件名 (默认: plan.json):',
        default: 'plan.json'
      }
    ]);

    const planString = JSON.stringify(operations, null, 2);
    const fullPath = path.resolve(fileName);

    await fs.writeFile(fullPath, planString, 'utf-8');

    console.log(
      CliStyle.success(`计划已导出到 ${CliStyle.filePath(fullPath)}`)
    );
    console.log(CliStyle.success('导出完成。'));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(CliStyle.error(`\n导出计划时出错: ${errorMessage}`));
  }
}

/**
 * 启动交互式审查循环，处理提议的文件操作。
 * @param operations - 初始文件操作列表。
 * @param promptMessage - 初始提示消息。
 * @param userPrompt - 原始用户请求，用于检查点描述。
 */
export async function reviewAndExecutePlan(
  operations: FileOperation[],
  promptMessage: string = '',
  userPrompt?: string,
  autoApply?: boolean
): Promise<{ applied: boolean }> {
  if (operations.length === 0) {
    return { applied: false };
  }

  let currentOperations = [...operations]; // 创建副本
  let inReviewLoop = true;
  let currentPromptMessage: string = promptMessage;
  let applied = false;

  // 初始验证
  const initialValidation =
    OperationValidator.validateOperations(currentOperations);
  if (!initialValidation.isValid && currentOperations.length > 0) {
    console.log(CliStyle.error('初始操作验证失败，将显示但可能无法执行。'));
    console.log(
      CliStyle.muted(
        `错误: ${initialValidation.errors?.slice(0, 3).join(', ') || '未知错误'}`
      )
    );
  }

  if (autoApply) {
    console.log(CliStyle.info('自动应用模式：跳过交互审查，直接执行计划。'));
    await displayPlan(currentOperations);

    // 应用前最终验证
    const finalValidation =
      OperationValidator.validateOperations(currentOperations);
    if (!finalValidation.isValid) {
      console.log(CliStyle.error('计划包含无效操作，无法自动应用。'));
      throw new Error(
        `无效操作: ${finalValidation.errors?.join('; ') || '未知验证错误'}`
      );
    }

    // 验证操作可达性
    console.log(CliStyle.info('正在验证操作可达性...'));
    const reachabilityValidation =
      await OperationValidator.validateOperationsReachability(
        currentOperations
      );
    if (!reachabilityValidation.isValid) {
      console.log(CliStyle.error('计划包含不可达操作，无法自动应用。'));
      reachabilityValidation.errors?.forEach((error) => {
        console.log(CliStyle.error(`  ${error}`));
      });
      throw new Error(
        `不可达操作: ${reachabilityValidation.errors?.join('; ') || '未知可达性错误'}`
      );
    }
    console.log(CliStyle.success('✓ 所有操作可达'));

    try {
      const result = await executePlan(
        currentOperations,
        userPrompt || 'AI plan execution'
      );
      applied = true;
    } catch (error) {
      console.error(
        CliStyle.error(`\n自动应用计划失败: ${(error as Error).message}`)
      );
      throw error;
    }

    console.log(CliStyle.success('计划已成功自动应用。'));
    return { applied };
  }

  while (inReviewLoop) {
    if (currentPromptMessage) {
      console.log(CliStyle.info(currentPromptMessage));
    }
    await displayPlan(currentOperations);

    const { choice } = await inquirer.prompt([
      {
        type: 'list',
        name: 'choice',
        message: '选择一个操作:',
        choices: [
          { name: '应用计划', value: 'apply' },
          { name: '审查更改（VS Code diff）', value: 'review' },
          { name: '导出计划 (JSON)', value: 'export' },
          { name: '取消', value: 'cancel' }
        ]
      }
    ]);

    switch (choice) {
      case 'apply':
        if (currentOperations.length === 0) {
          console.log(CliStyle.warning('没有可应用的文件操作。'));
          inReviewLoop = false;
        } else {
          try {
            const finalValidation =
              OperationValidator.validateOperations(currentOperations);
            if (!finalValidation.isValid) {
              console.log(CliStyle.error('计划包含无效操作，无法应用。'));
              const { forceApply } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'forceApply',
                  message: '是否强制应用可能无效的计划？',
                  default: false
                }
              ]);
              if (!forceApply) break;
            }

            console.log(CliStyle.info('正在验证操作可达性...'));
            const reachabilityValidation =
              await OperationValidator.validateOperationsReachability(
                currentOperations
              );
            if (!reachabilityValidation.isValid) {
              console.log(CliStyle.error('计划包含不可达操作，无法应用。'));
              reachabilityValidation.errors?.forEach((error) => {
                console.log(CliStyle.error(`  ${error}`));
              });
              const { tryAutoFix } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'tryAutoFix',
                  message: '是否尝试自动修复这些问题？',
                  default: true
                }
              ]);

              if (tryAutoFix) {
                const failedOps = currentOperations.map((op) => ({
                  operation: op,
                  error: '操作不可达或验证失败'
                }));
                const fixedOps = await autoFixOperations(failedOps);
                if (fixedOps) {
                  currentOperations = fixedOps;
                  currentPromptMessage = '计划已自动修复，请审查:';
                  break;
                }
              }

              const { forceApply } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'forceApply',
                  message: '自动修复失败。是否强制应用原计划？',
                  default: false
                }
              ]);
              if (!forceApply) break;
            } else {
              console.log(CliStyle.success('✓ 所有操作可达'));
            }

            const result = await executePlan(
              currentOperations,
              userPrompt || 'AI plan execution'
            );

            if (result.failedOperations && result.failedOperations.length > 0) {
              const { tryFix } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'tryFix',
                  message: `${result.failedOperations.length} 个操作执行失败。是否尝试自动修复？`,
                  default: true
                }
              ]);

              if (tryFix) {
                const fixedOps = await autoFixOperations(
                  result.failedOperations
                );
                if (fixedOps) {
                  currentOperations = fixedOps;
                  currentPromptMessage = '计划已自动修复，请审查并重新应用:';
                  break;
                }
              }
              throw new Error(
                `${result.failedOperations.length} 个操作执行失败`
              );
            }

            applied = true;
            inReviewLoop = false;
          } catch (error) {
            console.error(
              CliStyle.error(`\n应用计划失败: ${(error as Error).message}`)
            );
            inReviewLoop = false;
            throw error;
          }
        }
        break;

      case 'review':
        if (currentOperations.length === 0) {
          console.log(CliStyle.warning('没有可详细审查的文件操作。'));
        } else {
          currentOperations = await reviewChangesInDetail(currentOperations);
          if (currentOperations.length === 0) {
            console.log(CliStyle.success('所有操作已在审查中移除。'));
            inReviewLoop = false;
          } else {
            currentPromptMessage = '计划已更新。审查新计划:';
          }
        }
        break;

      case 'export':
        await exportPlanToJson(currentOperations);
        currentPromptMessage = '计划已导出。继续审查:';
        break;

      case 'cancel':
        console.log(CliStyle.error('操作已取消。'));
        inReviewLoop = false;
        break;
    }
  }

  // 重新显示更新后的计划，如果适用
  if (currentOperations.length > 0 && !applied) {
    await displayPlan(currentOperations);
  }

  if (applied) {
    console.log(CliStyle.success('计划已成功应用。'));
  } else {
    console.log(CliStyle.info('计划未应用。'));
  }

  return { applied };
}
