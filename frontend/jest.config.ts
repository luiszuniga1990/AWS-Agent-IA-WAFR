import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@wafr-portal/shared$': '<rootDir>/../shared/src/index.ts',
  },
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          target: 'ES2022',
          strict: true,
          skipLibCheck: true,
          baseUrl: '.',
          paths: {
            '@wafr-portal/shared': ['../shared/src/index.ts'],
          },
        },
      },
    ],
  },
};

export default config;
