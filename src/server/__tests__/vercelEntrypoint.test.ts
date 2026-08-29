import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const functionModules = [
  'api/index.ts',
  'src/server/app.ts',
  'src/server/extractionRoute.ts',
  'src/server/accountRoute.ts',
  'src/server/accountDeletion.ts',
  'src/server/firebaseAdmin.ts',
  'src/domain/reconciliation.ts',
];

test('Vercel function uses Node ESM-compatible relative imports', () => {
  const relativeImport = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g;

  for (const file of functionModules) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(relativeImport)) {
      assert.match(
        match[1],
        /\.js$/,
        `${file} must use an explicit .js extension for ${match[1]}`,
      );
    }
  }
});

test('Vercel packages the server modules imported by the function entrypoint', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    functions?: Record<string, { includeFiles?: string }>;
  };

  assert.strictEqual(config.functions?.['api/index.ts']?.includeFiles, 'src/**');
});
