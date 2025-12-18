import { getFileContext } from '../file-context';
import * as fs from 'fs/promises';
import { glob } from 'glob';
import { isFileIgnored } from '../../utils/file-utils';

jest.mock('fs/promises');
jest.mock('glob');
jest.mock('../../utils/file-utils');
jest.mock('../../utils/cli-style');

describe('getFileContext', () => {
  const mockGlob = glob as jest.MockedFunction<typeof glob>;
  const mockIsFileIgnored = isFileIgnored as jest.MockedFunction<typeof isFileIgnored>;
  const mockAccess = fs.access as jest.MockedFunction<typeof fs.access>;
  const mockReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>;
  const mockStat = fs.stat as jest.MockedFunction<typeof fs.stat>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStat.mockResolvedValue({ isDirectory: () => false } as any);
  });

  it('should filter ignored files when using glob patterns', async () => {
    mockGlob.mockResolvedValue([
      '/project/src/utils/__tests__/file.test.ts',
      '/project/src/utils/file-utils.ts'
    ] as any);
    
    mockIsFileIgnored.mockImplementation(async (path: string) => {
      return path.includes('__tests__');
    });

    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('test content');

    const result = await getFileContext(['src/**/*.ts']);
    
    expect(mockIsFileIgnored).toHaveBeenCalledTimes(2);
    expect(result).toContain('file-utils.ts');
    expect(result).not.toContain('file.test.ts');
  });

  it('should respect negative patterns in maiignore', async () => {
    mockGlob.mockResolvedValue([
      '/project/src/__tests__/important.test.ts',
      '/project/src/__tests__/other.test.ts'
    ] as any);
    
    mockIsFileIgnored.mockImplementation(async (path: string) => {
      return path.includes('__tests__') && !path.includes('important');
    });

    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('test content');

    const result = await getFileContext(['src/**/*.ts']);
    
    expect(result).toContain('important.test.ts');
    expect(result).not.toContain('other.test.ts');
  });

  it('should include all files when none are ignored', async () => {
    mockGlob.mockResolvedValue([
      '/project/src/file1.ts',
      '/project/src/file2.ts'
    ] as any);
    
    mockIsFileIgnored.mockResolvedValue(false);
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('test content');

    const result = await getFileContext(['src/**/*.ts']);
    
    expect(result).toContain('file1.ts');
    expect(result).toContain('file2.ts');
  });

  it('should handle non-glob file patterns without filtering', async () => {
    mockAccess.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('test content');

    const result = await getFileContext(['src/file.ts']);
    
    expect(mockIsFileIgnored).not.toHaveBeenCalled();
    expect(mockGlob).not.toHaveBeenCalled();
  });
});