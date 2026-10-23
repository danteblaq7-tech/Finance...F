export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}

/** The API returns wall-clock strings like "2026-10-17 10:00:00". Parse them as local time. */
export function parseWall(s) {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T'));
}

export function formatDateTime(s) {
  if (!s) return '—';
  return parseWall(s).toLocaleString('en-KE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(s) {
  if (!s) return '—';
  return parseWall(s).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(s) {
  return parseWall(s).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatKsh(n) {
  return `KSh ${Number(n).toLocaleString('en-KE')}`;
}

/** Local-calendar YYYY-MM-DD (not UTC), so "today" matches the user's wall clock. */
export function toDateString(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Replace {{var}} placeholders. Values are HTML-escaped so user data can't inject markup. */
export function renderTemplate(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => escapeHtml(String(vars[key] ?? '')));
}

export const cardNumber = (applicationId) =>
  `FC-${applicationId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const homeFor = (role) => (role === 'student' ? '/tickets' : '/staff/queue');
