import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, mock, test } from 'node:test';

const migrationVersions = [
  '20261122180000',
  '20261122190000',
  '20261122200000',
  '20261122201000',
  '20261123070000',
];
const profileColumns = ['id', 'name', 'email', 'role', 'is_active', 'must_change_password'];
let appliedMigrations;
let availableColumns;
let migrationTableExists;
let existingAdmin;
let authUsers;
let authCalls;
let profileWrites;
let output;
let runBootstrap;

const db = {
  connect: async () => ({
    query: async (sql, params = []) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/to_regclass\('supabase_migrations\.schema_migrations'\)/.test(sql)) {
        return { rows: [{ migration_table: migrationTableExists ? 'supabase_migrations.schema_migrations' : null }] };
      }
      if (/FROM supabase_migrations\.schema_migrations/.test(sql)) {
        return { rows: appliedMigrations.filter((version) => params[0].includes(version)).map((version) => ({ version })) };
      }
      if (/FROM information_schema\.columns/.test(sql)) {
        return { rows: availableColumns.filter((column) => params[0].includes(column)).map((column_name) => ({ column_name })) };
      }
      if (/SELECT id FROM public\.profiles WHERE role = 'admin'/.test(sql)) {
        return { rows: existingAdmin ? [{ id: 'existing-admin' }] : [] };
      }
      if (/INSERT INTO public\.profiles/.test(sql)) {
        profileWrites.push({ sql, params });
        return { rowCount: 1, rows: [{ id: params[0] }] };
      }
      throw new Error(`Unexpected SQL in test: ${sql}`);
    },
    release() {},
  }),
};

const authAdmin = {
  listUsers: async ({ page }) => {
    authCalls.push(['listUsers', page]);
    return { data: { users: page === 1 ? authUsers : [] }, error: null };
  },
  createUser: async (value) => {
    authCalls.push(['createUser', value]);
    return { data: { user: { id: 'new-auth-user', email: value.email } }, error: null };
  },
  updateUserById: async (id, value) => {
    authCalls.push(['updateUserById', id, value]);
    return { error: null };
  },
};

mock.module(new URL('../../src/db.js', import.meta.url).href, {
  namedExports: { pool: db },
});
mock.module(new URL('../../src/supabase.js', import.meta.url).href, {
  namedExports: { supabaseAdmin: { auth: { admin: authAdmin } } },
});

before(async () => {
  ({ runBootstrap } = await import('../../scripts/bootstrap-first-admin.js'));
});

beforeEach(() => {
  appliedMigrations = [...migrationVersions];
  availableColumns = [...profileColumns];
  migrationTableExists = true;
  existingAdmin = false;
  authUsers = [];
  authCalls = [];
  profileWrites = [];
  output = '';
});

afterEach(() => {
  mock.reset();
});

describe('first-admin bootstrap', () => {
  test('stops before Auth changes when required migrations are not applied', async () => {
    appliedMigrations = migrationVersions.slice(0, 1);
    await assert.rejects(
      runBootstrap({ dbPool: db, authAdmin, input: { name: 'Staging Admin', email: 'admin@example.test' } }),
      /Required Supabase migrations are missing/,
    );
    assert.deepEqual(authCalls, []);
    assert.deepEqual(profileWrites, []);
  });

  test('stops clearly if the migration history table is missing', async () => {
    migrationTableExists = false;
    await assert.rejects(
      runBootstrap({ dbPool: db, authAdmin, input: { name: 'Staging Admin', email: 'admin@example.test' } }),
      /Run `supabase db push`/,
    );
    assert.deepEqual(authCalls, []);
  });

  test('recovers an existing Auth user by creating or promoting its profile', async () => {
    authUsers = [{
      id: 'partial-auth-user',
      email: 'admin@example.test',
      user_metadata: { existing: true },
    }];
    const stream = { write: (value) => { output += value; } };
    await runBootstrap({
      dbPool: db,
      authAdmin,
      input: { name: 'Staging Admin', email: 'ADMIN@example.test' },
      output: stream,
    });

    const resetCall = authCalls.find(([method]) => method === 'updateUserById');
    assert.equal(resetCall[1], 'partial-auth-user');
    assert.equal(resetCall[2].user_metadata.existing, true);
    assert.equal(profileWrites[0].params[0], 'partial-auth-user');
    assert.equal(profileWrites[0].params[2], 'admin@example.test');
    assert.match(output, /Temporary password \(shown once\):/);
    const password = resetCall[2].password;
    assert.equal(output.split(password).length - 1, 1);
    assert.equal(profileWrites[0].params.includes(password), false);
  });

  test('creates an Auth user and emits the generated password once after commit', async () => {
    const stream = { write: (value) => { output += value; } };
    await runBootstrap({
      dbPool: db,
      authAdmin,
      input: { name: 'Staging Admin', email: 'admin@example.test' },
      output: stream,
    });

    const createCall = authCalls.find(([method]) => method === 'createUser');
    const password = createCall[1].password;
    assert.equal(password.length >= 40, true);
    assert.equal(output.split(password).length - 1, 1);
    assert.equal(profileWrites[0].params.includes(password), false);
  });
});
