import { CliStyle } from '../cli-style';

jest.mock('chalk');

describe('CliStyle', () => {
  it('应该导出 CliStyle 类', () => {
    expect(CliStyle).toBeDefined();
  });
});