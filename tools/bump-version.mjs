#!/usr/bin/env node
/* Update Echo's visible release and package date metadata together. */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE_RE = /^(\d{4})\.(\d{2})\.(\d{2})\.([1-9]\d*)$/;

export function releaseParts(value) {
  const match = RELEASE_RE.exec(String(value || ""));
  if (!match) {
    throw new Error("版號格式必須是 YYYY.MM.DD.N,例如 2026.08.17.1");
  }
  const [, year, month, day, sequence] = match;
  const date = new Date(Date.UTC(+year, +month - 1, +day));
  if (
    date.getUTCFullYear() !== +year ||
    date.getUTCMonth() + 1 !== +month ||
    date.getUTCDate() !== +day
  ) {
    throw new Error("版號中的日期不存在");
  }
  return { year, month, day, sequence };
}

export async function bumpVersion(nextVersion, root = DEFAULT_ROOT) {
  const parts = releaseParts(nextVersion);
  const versionPath = join(root, "js", "version.js");
  const packagePath = join(root, "package.json");
  const [versionSource, packageSource] = await Promise.all([
    readFile(versionPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const current = versionSource.match(/const app = "([^"]+)";/)?.[1];
  if (!current) throw new Error("找不到 js/version.js 的 App 版號");
  if (current === nextVersion) throw new Error(`目前已經是 v${nextVersion}`);

  const nextSource = versionSource.replace(
    /const app = "[^"]+";/,
    `const app = "${nextVersion}";`,
  );
  const packageJson = JSON.parse(packageSource);
  packageJson.version = [parts.year, +parts.month, +parts.day].join(".");

  await Promise.all([
    writeFile(versionPath, nextSource),
    writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`),
  ]);
  return { app: nextVersion, package: packageJson.version };
}

const direct =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (direct) {
  try {
    const result = await bumpVersion(process.argv[2]);
    console.log(`Echo ${result.app} (package ${result.package})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
