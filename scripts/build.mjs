import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
chmodSync('dist/src/cli.js', 0o755);
copyFileSync('package.json', 'dist/package.json');
