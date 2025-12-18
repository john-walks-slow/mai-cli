import {
  startDelimiter,
  endDelimiter,
  escapeDelimiters,
  unescapeDelimiters,
  OperationDescriptions
} from '../operation-definitions';

describe('operation-definitions', () => {
  describe('startDelimiter', () => {
    it('应该生成默认分隔符', () => {
      expect(startDelimiter()).toBe('--- OPERATION start ---');
    });

    it('应该生成自定义分隔符', () => {
      expect(startDelimiter('FILE')).toBe('--- FILE start ---');
    });
  });

  describe('endDelimiter', () => {
    it('应该生成默认分隔符', () => {
      expect(endDelimiter()).toBe('--- OPERATION end ---');
    });

    it('应该生成自定义分隔符', () => {
      expect(endDelimiter('content')).toBe('--- content end ---');
    });
  });


  describe('escapeDelimiters', () => {
    it('应该转义行首的分隔符', () => {
      const result = escapeDelimiters('--- test');
      expect(result).toBe('\\--- test');
    });

    it('应该转义行尾的分隔符', () => {
      const result = escapeDelimiters('test ---');
      expect(result).toBe('test ---\\');
    });

    it('应该处理多行内容', () => {
      const result = escapeDelimiters('--- line1\nline2 ---');
      expect(result).toBe('\\--- line1\nline2 ---\\');
    });
  });

  describe('escapeDelimiters 和 unescapeDelimiters', () => {
    it('应该转义行首的分隔符', () => {
      const result = escapeDelimiters('--- test');
      expect(result).toContain('\\');
      expect(result).toContain('---');
    });

    it('应该转义行尾的分隔符', () => {
      const result = escapeDelimiters('test ---');
      expect(result).toContain('---');
      expect(result).toContain('\\');
    });

    it('应该验证转义函数存在', () => {
      expect(typeof escapeDelimiters).toBe('function');
      expect(typeof unescapeDelimiters).toBe('function');
    });
  });

  describe('OperationDescriptions', () => {
    describe('getOperationsDescription', () => {
      it('应该生成操作描述', () => {
        const desc = OperationDescriptions.getOperationsDescription();
        expect(desc).toBeTruthy();
        expect(desc.length).toBeGreaterThan(0);
      });

      it('应该包含所有操作类型', () => {
        const desc = OperationDescriptions.getOperationsDescription();
        expect(desc).toContain('response');
        expect(desc).toContain('create');
        expect(desc).toContain('edit');
        expect(desc).toContain('move');
        expect(desc).toContain('delete');
        expect(desc).toContain('list_directory');
        expect(desc).toContain('search_content');
        expect(desc).toContain('read_file');
      });

      it('应该包含操作分隔符', () => {
        const desc = OperationDescriptions.getOperationsDescription();
        expect(desc).toContain(startDelimiter());
        expect(desc).toContain(endDelimiter());
      });

      it('应该包含字段示例', () => {
        const desc = OperationDescriptions.getOperationsDescription();
        expect(desc).toContain('【参数示例】');
      });
    });
  });
});