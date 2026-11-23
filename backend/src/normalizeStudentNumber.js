export function normalizeStudentNumber(value) {
  return value.trim().toUpperCase().replace(/[\s/-]+/g, '/').replace(/^\/+|\/+$/g, '');
}

export function matchesStudentNumberPattern(value, pattern) {
  pattern.lastIndex = 0;
  return pattern.test(value);
}
