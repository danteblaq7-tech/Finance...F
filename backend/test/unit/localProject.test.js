import assert from 'node:assert/strict';
import test from 'node:test';
import { assertLocalDemoTarget } from '../../src/localProject.js';

const local = {
  nodeEnv: 'development',
  supabaseUrl: 'http://127.0.0.1:54321',
  databaseUrl: 'postgresql://postgres:postgres@localhost:54322/postgres',
};

test('allows demo operations only against local Supabase and database endpoints', () => {
  assert.doesNotThrow(() => assertLocalDemoTarget(local));
});

test('refuses demo operations in production even for local endpoints', () => {
  assert.throws(() => assertLocalDemoTarget({ ...local, nodeEnv: 'production' }), /disabled.*production/i);
});

test('refuses hosted Supabase or database targets outside production', () => {
  assert.throws(() => assertLocalDemoTarget({ ...local, supabaseUrl: 'https://project.supabase.co' }), /local Supabase CLI/i);
  assert.throws(() => assertLocalDemoTarget({ ...local, databaseUrl: 'postgresql://db.pooler.supabase.com/postgres' }), /local Supabase CLI/i);
});

test('refuses missing or malformed target URLs', () => {
  assert.throws(() => assertLocalDemoTarget({ ...local, supabaseUrl: undefined }), /local Supabase CLI/i);
  assert.throws(() => assertLocalDemoTarget({ ...local, databaseUrl: 'not-a-url' }), /local Supabase CLI/i);
});
