import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assertStagingIntegrationTarget } from '../../src/integrationTestGuard.js';

const staging = {
  ALLOW_INTEGRATION_TESTS: 'staging',
  SUPABASE_URL: 'https://jqmxcnilrwgirsdufzjn.supabase.co',
  DATABASE_URL: 'postgresql://postgres.jqmxcnilrwgirsdufzjn:password@aws-0-test.pooler.supabase.com:5432/postgres',
};

describe('staging integration test guard', () => {
  test('requires explicit staging opt-in', () => {
    assert.throws(() => assertStagingIntegrationTarget({ ...staging, ALLOW_INTEGRATION_TESTS: '' }), /disabled/);
  });

  test('allows only the exact staging Supabase project URL', () => {
    assert.doesNotThrow(() => assertStagingIntegrationTarget(staging));
    assert.throws(() => assertStagingIntegrationTarget({ ...staging, SUPABASE_URL: 'https://other.supabase.co' }), /restricted/);
    assert.throws(() => assertStagingIntegrationTarget({ ...staging, SUPABASE_URL: 'http://jqmxcnilrwgirsdufzjn.supabase.co' }), /restricted/);
    assert.throws(() => assertStagingIntegrationTarget({ ...staging, DATABASE_URL: 'postgresql://postgres:password@localhost:5432/postgres' }), /staging database/);
  });
});
