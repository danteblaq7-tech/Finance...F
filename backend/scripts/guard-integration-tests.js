import 'dotenv/config';
import { assertStagingIntegrationTarget } from '../src/integrationTestGuard.js';

try {
  assertStagingIntegrationTarget();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
