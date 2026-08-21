import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVitest } from 'vitest/node';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitest = await startVitest('test', [], {
  run: true,
  root,
  globals: true,
  environment: 'jsdom',
  setupFiles: ['./src/tests/setup.ts'],
  include: ['src/**/*.test.{ts,tsx}'],
}, {
  configFile: false,
  resolve: { alias: { '@': path.join(root, 'src') } },
});

await vitest?.close();
