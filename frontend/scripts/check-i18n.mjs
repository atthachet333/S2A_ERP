import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const excluded = /(?:\/i18n\/|\/tests?\/)/;
const thai = /[\u0E00-\u0E7F]/;
const sourceExtensions = new Set(['.ts', '.tsx']);
const findings = [];
let scanned = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (sourceExtensions.has(extname(path)) && !excluded.test(path)) {
      scanned += 1;
      const lines = (await readFile(path, 'utf8')).split(/\r?\n/);
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (thai.test(line) && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      findings.push(`${relative(root, path)}:${index + 1}: ${trimmed.slice(0, 180)}`);
        }
      });
    }
  }
}

await walk(root);
console.log(`Scanned ${scanned} frontend TypeScript files.`);
console.log(`Found ${findings.length} Thai-containing source lines outside dictionaries and tests.`);
for (const finding of findings) console.log(finding);
if (process.argv.includes('--strict') && findings.length) process.exitCode = 1;
