#!/usr/bin/env node
/* Parse every JavaScript module without executing browser-only code. */

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function modules(dir) {
  const out = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(m?js)$/.test(entry.name)) out.push(path);
    }
  }
  await walk(dir);
  return out;
}

const files = (await Promise.all(
  ['js', 'tools', 'test'].map((dir) => modules(join(root, dir))),
)).flat().sort();
const problems = [];

for (const file of files) {
  try {
    await run(process.execPath, ['--check', file]);
  } catch (error) {
    problems.push(`${relative(root, file)}\n${String(error.stderr || error.message).trim()}`);
  }
}

if (problems.length) {
  console.error(`syntax check failed in ${problems.length} file(s):\n${problems.join('\n\n')}`);
  process.exitCode = 1;
} else {
  console.log(`syntax OK: ${files.length} JavaScript modules`);
}
