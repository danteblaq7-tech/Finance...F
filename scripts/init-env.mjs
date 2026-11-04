// npm run env:init
// Creates backend/.env, web/.env and mobile/.env from their .env.example templates (never overwrites an existing file)
// and tells you what is still left to fill in.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['backend', 'web', 'mobile'];
const placeholder = /your[-_ ]?(project|password|anon|service|ref)|\[YOUR|paste[-_ ]/i;

let todo = 0;
for (const dir of targets) {
  const example = join(root, dir, '.env.example');
  const env = join(root, dir, '.env');
  if (!existsSync(example)) continue;
  if (existsSync(env)) {
    console.log(`= ${dir}/.env already exists (left untouched)`);
  } else {
    copyFileSync(example, env);
    console.log(`+ created ${dir}/.env`);
  }
  const open = readFileSync(env, 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l) && placeholder.test(l))
    .map((l) => l.split('=')[0]);
  if (open.length) {
    todo += open.length;
    console.log(`    ✎ still to fill in ${dir}/.env: ${open.join(', ')}`);
  }
}
console.log(
  todo
    ? '\nNext: put your team\'s Supabase values into those files (ask the project owner, or see README → "Supabase setup"), then run:  npm run setup  &&  npm run dev'
    : '\nAll set. Run:  npm run setup  &&  npm run dev',
);
