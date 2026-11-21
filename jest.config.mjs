/** Jest configuration: unit / integration / security projects. */
const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@becbarrier/(contracts|domain|security)$': '<rootDir>/packages/$1/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tests/tsconfig.json' }],
  },
};

export default {
  projects: [
    {
      displayName: 'unit',
      ...shared,
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
    },
    {
      displayName: 'integration',
      ...shared,
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      globalSetup: '<rootDir>/tests/integration/global-setup.cjs',
      globalTeardown: '<rootDir>/tests/integration/global-teardown.cjs',
      setupFiles: ['<rootDir>/tests/helpers/setup-files/test-env.ts'],
      maxWorkers: 1,
    },
    {
      displayName: 'security',
      ...shared,
      testMatch: ['<rootDir>/tests/security/**/*.test.ts'],
      globalSetup: '<rootDir>/tests/integration/global-setup.cjs',
      globalTeardown: '<rootDir>/tests/integration/global-teardown.cjs',
      setupFiles: ['<rootDir>/tests/helpers/setup-files/test-env.ts'],
      maxWorkers: 1,
    },
  ],
};
