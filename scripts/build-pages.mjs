import { spawnSync } from 'node:child_process';

// Invoking the npm CLI through Node also works on Windows, without shell env syntax.
if (!process.env.npm_execpath) throw new Error('Run this script with npm run build:pages.');
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, DEPLOY_BASE: '/eco-detective/' },
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
