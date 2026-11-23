import { z } from 'zod';
import { config } from './config.js';
import { logger } from './logger.js';

const categories = ['fee_dispute', 'payment_plan', 'sponsorship', 'helb', 'bursary', 'fee_statement', 'other'];
const priorities = ['low', 'medium', 'high'];
const resultSchema = z.object({
  suggestedCategory: z.enum(categories),
  suggestedPriority: z.enum(priorities),
  rationale: z.string().trim().min(1).max(500),
});

export class ClassifierProvider {
  constructor(name) {
    this.name = name;
  }

  async classify() {
    throw new Error('ClassifierProvider.classify must be implemented.');
  }
}

const categoryTerms = [
  ['fee_dispute', /\b(disput\w*|incorrect|wrong|overcharg\w*|balance|charged)\b/i],
  ['payment_plan', /\b(payment plan|instalment|installment|repay\w*)\b/i],
  ['sponsorship', /\b(sponsor\w*|scholarship)\b/i],
  ['helb', /\b(helb|loan disbursement|loan allocation)\b/i],
  ['bursary', /\b(bursar\w*|bursary|grant)\b/i],
  ['fee_statement', /\b(statement|receipt|proof of payment|payment confirmation)\b/i],
];

const urgencyTerms = /\b(urgent|deadline|today|tomorrow|blocked|unable to register|exam(?:ination)? (?:is )?near)\b/i;
const generalInquiryTerms = /\b(general enquiry|general inquiry|information only|when will|how do i)\b/i;

export function redactClassifierInput(description, issueType = 'other') {
  const text = String(description ?? '');
  return JSON.stringify({
    issueType: categories.includes(issueType) ? issueType : 'other',
    categorySignals: Object.fromEntries(categoryTerms.map(([category, pattern]) => [category, pattern.test(text)])),
    urgent: urgencyTerms.test(text),
    generalInquiry: generalInquiryTerms.test(text),
  });
}

export class RulesClassifierProvider extends ClassifierProvider {
  constructor({ now = () => new Date() } = {}) {
    super('rules');
    this.now = now;
  }

  async classify({ issueType, description }) {
    const text = String(description ?? '');
    const matchedCategory = categoryTerms.find(([, pattern]) => pattern.test(text))?.[0];
    const urgent = urgencyTerms.test(text);
    const lowPriority = generalInquiryTerms.test(text);
    const priority = urgent ? 'high' : lowPriority ? 'low' : 'medium';
    const category = matchedCategory ?? (categories.includes(issueType) ? issueType : 'other');
    const rationale = urgent
      ? 'Urgency or a time-sensitive blocker was mentioned.'
      : matchedCategory
        ? `The description contains terms associated with ${category.replaceAll('_', ' ')}.`
        : 'No strong category or urgency signals were found; the submitted category was retained.';
    return {
      suggestedCategory: category,
      suggestedPriority: priority,
      rationale,
      providerName: this.name,
      timestamp: this.now().toISOString(),
    };
  }
}

export class LlmClassifierProvider extends ClassifierProvider {
  constructor({ endpoint, apiKey, model, timeoutMs = 4000, fetchImpl = fetch, now = () => new Date() }) {
    super(`llm:${model}`);
    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  async classify({ issueType, description }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          store: false,
          messages: [
            {
              role: 'system',
              content: `Classify the redacted finance support description. Return only JSON with suggestedCategory (${categories.join(', ')}), suggestedPriority (${priorities.join(', ')}), and a brief rationale. Do not resolve the ticket.`,
            },
            { role: 'user', content: redactClassifierInput(description, issueType) },
          ],
          response_format: { type: 'json_object' },
        }),
      });
      if (!response.ok) throw new Error(`Classifier HTTP ${response.status}`);
      const body = await response.json();
      const content = body?.choices?.[0]?.message?.content;
      const parsed = resultSchema.parse(JSON.parse(content));
      return { ...parsed, providerName: this.name, timestamp: this.now().toISOString() };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createClassifier(options = config.classifier) {
  if (options.apiKey) return new LlmClassifierProvider(options);
  return new RulesClassifierProvider(options);
}

export function defaultClassification(issueType, now = () => new Date()) {
  return {
    suggestedCategory: categories.includes(issueType) ? issueType : 'other',
    suggestedPriority: 'medium',
    rationale: 'Classifier unavailable; the ticket was created with the default priority.',
    providerName: 'fallback',
    timestamp: now().toISOString(),
  };
}

const provider = createClassifier();

export async function classifyTicket(input) {
  try {
    return resultSchema.extend({
      providerName: z.string().min(1),
      timestamp: z.string().datetime(),
    }).parse(await provider.classify(input));
  } catch (error) {
    logger.warn('ticket_classification_unavailable', { errorCode: error?.name });
    return defaultClassification(input.issueType);
  }
}
