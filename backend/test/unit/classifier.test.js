import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ClassifierProvider,
  LlmClassifierProvider,
  RulesClassifierProvider,
  createClassifier,
  defaultClassification,
  redactClassifierInput,
} from '../../src/classifier.js';

const now = () => new Date('2026-11-23T06:00:00.000Z');

describe('ticket classifier providers', () => {
  test('uses the deterministic rules provider by default and classifies category and urgency', async () => {
    const provider = createClassifier({ apiKey: '', now });
    assert.ok(provider instanceof RulesClassifierProvider);
    assert.ok(provider instanceof ClassifierProvider);
    const result = await provider.classify({
      issueType: 'other',
      description: 'My bursary application is urgent because the registration deadline is today.',
    });
    assert.equal(result.suggestedCategory, 'bursary');
    assert.equal(result.suggestedPriority, 'high');
    assert.equal(result.rationale, 'Urgency or a time-sensitive blocker was mentioned.');
    assert.equal(result.providerName, 'rules');
    assert.equal(result.timestamp, now().toISOString());
  });

  test('sends only non-PII classifier signals to the optional provider', async () => {
    let request;
    const provider = new LlmClassifierProvider({
      endpoint: 'https://classifier.example/v1/chat/completions',
      apiKey: 'test-secret',
      model: 'test-model',
      now,
      fetchImpl: async (_url, options) => {
        request = options;
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ suggestedCategory: 'fee_dispute', suggestedPriority: 'medium', rationale: 'A balance dispute was described.' }) } }] }),
        };
      },
    });
    const result = await provider.classify({
      issueType: 'other',
      description: 'Amina Hassan (COM/072/23), student@example.com, phone +254 712 345 678, account 12345678, KES 45,000 dispute.',
    });
    const serialized = request.body;
    assert.equal(serialized.includes('COM/072/23'), false);
    assert.equal(serialized.includes('student@example.com'), false);
    assert.equal(serialized.includes('12345678'), false);
    assert.equal(serialized.includes('Amina Hassan'), false);
    assert.equal(serialized.includes('45,000'), false);
    assert.deepEqual(JSON.parse(serialized).messages[1].content, JSON.stringify({
      issueType: 'other',
      categorySignals: {
        fee_dispute: true,
        payment_plan: false,
        sponsorship: false,
        helb: false,
        bursary: false,
        fee_statement: false,
      },
      urgent: false,
      generalInquiry: false,
    }));
    assert.equal(JSON.parse(serialized).store, false);
    assert.equal(request.headers.Authorization, 'Bearer test-secret');
    assert.deepEqual(result, {
      suggestedCategory: 'fee_dispute',
      suggestedPriority: 'medium',
      rationale: 'A balance dispute was described.',
      providerName: 'llm:test-model',
      timestamp: '2026-11-23T06:00:00.000Z',
    });
  });

  test('rejects malformed provider outputs and signals request timeout', async () => {
    const malformed = new LlmClassifierProvider({
      endpoint: 'https://classifier.example',
      apiKey: 'key',
      model: 'model',
      fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"suggestedCategory":"not-valid"}' } }] }) }),
    });
    await assert.rejects(malformed.classify({ description: 'some request' }));

    const timedOut = new LlmClassifierProvider({
      endpoint: 'https://classifier.example',
      apiKey: 'key',
      model: 'model',
      timeoutMs: 5,
      fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
    });
    await assert.rejects(timedOut.classify({ description: 'some request' }), { name: 'AbortError' });
  });

  test('fallback classification always selects the default priority', () => {
    assert.equal(defaultClassification('helb', now).suggestedPriority, 'medium');
    assert.equal(defaultClassification('helb', now).suggestedCategory, 'helb');
    const safeSignals = JSON.parse(redactClassifierInput('Call +254 712 345 678'));
    assert.equal(JSON.stringify(safeSignals).includes('+254'), false);
  });
});
