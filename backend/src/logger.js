const safeValue = (value, pattern, fallback = 'unknown') => {
  const text = String(value ?? '');
  return pattern.test(text) ? text : fallback;
};

function write(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event: safeValue(event, /^[a-z0-9_]{1,60}$/i),
  };
  if (fields.requestId) entry.requestId = safeValue(fields.requestId, /^[a-f0-9-]{36}$/i);
  if (fields.errorCode) entry.errorCode = safeValue(fields.errorCode, /^[a-z0-9_]{1,40}$/i);
  if (fields.method) entry.method = safeValue(fields.method, /^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)$/);
  if (fields.route) entry.route = safeValue(fields.route, /^[a-z0-9_/:.-]{1,160}$/i, 'unmatched');
  if (Number.isInteger(fields.status)) entry.status = fields.status;
  if (Number.isFinite(fields.durationMs)) entry.durationMs = Math.max(0, Math.round(fields.durationMs));
  if (Number.isInteger(fields.count)) entry.count = Math.max(0, fields.count);
  const output = JSON.stringify(entry);
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
