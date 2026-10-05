import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const backendRoot = fileURLToPath(new URL('../', import.meta.url));
const child = spawn(
  process.execPath,
  [
    fileURLToPath(new URL('../node_modules/kysely-codegen/dist/cli/bin.js', import.meta.url)),
    '--dialect=postgres',
    '--env-file=.env',
    '--url=env(DATABASE_URL)',
    '--out-file=src/generated/database.types.ts'
  ],
  { cwd: backendRoot, stdio: 'inherit' }
);

const [exitCode] = (await once(child, 'exit')) as [number | null];
if (exitCode !== 0) {
  process.exitCode = exitCode ?? 1;
}
