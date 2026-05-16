import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildApp } from '../src/app';

async function main() {
  const app = await buildApp();
  await app.ready();

  const spec = app.swagger();
  const out = resolve(process.cwd(), 'docs/api-client.json');

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(spec, null, 2) + '\n');
  await app.close();

  console.log(`OpenAPI spec written to ${out}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
