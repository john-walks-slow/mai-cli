module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/**/__tests__/**',
    '!src/__mocks__/**',
    '!src/commands/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 48,
      functions: 59,
      lines: 60,
      statements: 59
    }
  },
  moduleNameMapper: {
    '^chalk$': '<rootDir>/src/__mocks__/chalk.ts',
    '^inquirer$': '<rootDir>/src/__mocks__/inquirer.ts'
  }
};
