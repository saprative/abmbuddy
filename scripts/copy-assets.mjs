#!/usr/bin/env node
// Copies non-TypeScript runtime assets (agent prompts) from src/ into dist/,
// so prompt.md files stay editable next to the compiled agent that loads them.
import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "src");
const dist = join(root, "dist");

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let copied = 0;
for await (const file of walk(src)) {
  if (!file.endsWith(".md")) continue;
  const target = join(dist, relative(src, file));
  await mkdir(dirname(target), { recursive: true });
  await cp(file, target);
  copied++;
}
console.log(`copy-assets: ${copied} prompt file(s) copied to dist/`);
