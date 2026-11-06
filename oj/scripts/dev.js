import { spawn } from 'node:child_process';

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm so npm_execpath is available.');

const commands = [
  ['API', ['run', 'dev', '--workspace', '@oj/server']],
  ['Client', ['run', 'dev', '--workspace', '@oj/client']],
];
const children = commands.map(([name, args]) => {
  const child = spawn(process.execPath, [npmCli, ...args], { stdio: 'inherit' });
  child.once('error', (error) => {
    process.stderr.write(`${name} development process failed: ${error.message}\n`);
    stop(1);
  });
  child.once('exit', (code) => {
    if (!stopping) {
      process.stderr.write(`${name} development process exited (${code ?? 'signal'}).\n`);
      stop(code ?? 1);
    }
  });
  return child;
});

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
