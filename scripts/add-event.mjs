// Adds Partiful events to events.json.
// Usage: node scripts/add-event.mjs <partiful URL or event ID> [...more]
// Accepts full links like https://partiful.com/e/HYbSYc27B13X0W7yjL3R?c=abc.

import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../events.json', import.meta.url);
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/add-event.mjs <partiful URL or event ID> [...more]');
  process.exit(1);
}

const ids = JSON.parse(await readFile(file, 'utf8'));
let added = 0;
for (const arg of args) {
  const id = (arg.match(/partiful\.com\/e\/([A-Za-z0-9]+)/) || [])[1] || arg;
  if (!/^[A-Za-z0-9]{20}$/.test(id)) {
    console.error(`Not a Partiful event link or ID: ${arg}`);
    process.exit(1);
  }
  if (ids.includes(id)) {
    console.log(`Already listed: ${id}`);
    continue;
  }
  ids.push(id);
  added++;
  console.log(`Added: ${id}`);
}
await writeFile(file, JSON.stringify(ids, null, 2) + '\n');
console.log(`${added} added, ${ids.length} events listed`);
