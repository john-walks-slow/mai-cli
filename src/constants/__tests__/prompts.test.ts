import { constructSystemPrompt, createUserPrompt } from '../prompts';
import { startDelimiter, endDelimiter } from '../../core/operation-definitions';

describe('prompts', () => {
  describe('constructSystemPrompt', () => {
    it('应该返回包含角色定义的系统提示', () => {
      const prompt = constructSystemPrompt();
      
      expect(prompt).toContain('MAI (Minimal AI Interface)');
      expect(prompt).toContain('文件操作 AI 助手');
    });

    it('应该包含操作块分隔符说明', () => {
      const prompt = constructSystemPrompt();
      
      expect(prompt).toContain(startDelimiter());
      expect(prompt).toContain(endDelimiter());
    });

    it('应该包含操作块定义', () => {
      const prompt = constructSystemPrompt();
      
      expect(prompt).toContain('操作块定义');
    });

    it('应该包含格式要求', () => {
      const prompt = constructSystemPrompt();
      
      expect(prompt).toContain('格式要求');
      expect(prompt).toContain('绝对路径');
    });

    it('应该包含文件上下文说明', () => {
      const prompt = constructSystemPrompt();
      
      expect(prompt).toContain('文件上下文');
      expect(prompt).toContain(startDelimiter('FILE'));
      expect(prompt).toContain(endDelimiter('FILE'));
    });

    it('应该包含信息收集操作说明', () => {
      const prompt = constructSystemPrompt();
      
      expect(prompt).toContain('信息收集');
      expect(prompt).toContain('list_directory');
      expect(prompt).toContain('search_content');
      expect(prompt).toContain('read_file');
    });

    it('应该包含最佳实践指导', () => {
      const prompt = constructSystemPrompt();
      
      expect(prompt).toContain('最佳实践');
      expect(prompt).toContain('comment');
    });
  });

  describe('createUserPrompt', () => {
    it('应该返回用户输入的原始文本', () => {
      const userInput = '创建一个新文件';
      const result = createUserPrompt(userInput);
      
      expect(result).toBe(userInput);
    });

    it('应该处理空字符串', () => {
      const result = createUserPrompt('');
      
      expect(result).toBe('');
    });

    it('应该保留多行文本', () => {
      const userInput = '第一行\n第二行\n第三行';
      const result = createUserPrompt(userInput);
      
      expect(result).toBe(userInput);
    });
  });
});