/** The API returns wall-clock strings like "2026-10-17 10:00:00". Parse them as local time. */
export function parseWall(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T'));
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Formatting is done by hand (not Intl/toLocaleString) so output is identical on every device and JS engine.
export function formatTime(s: string): string {
  const d = parseWall(s);
  const h = d.getHours();
  return `${pad(h % 12 === 0 ? 12 : h % 12)}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = parseWall(s);
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = parseWall(s);
  return `${DAYS[d.getDay()]} ${pad(d.getDate())} ${MONTHS[d.getMonth()]}, ${formatTime(s)}`;
}

export function formatDay(s: string): string {
  const d = parseWall(s);
  return `${DAYS[d.getDay()]} ${pad(d.getDate())} ${MONTHS[d.getMonth()]}`;
}

export function formatKsh(n: number): string {
  return `KSh ${Math.round(Number(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/** Local-calendar YYYY-MM-DD (not UTC), so "today" matches the user's wall clock. */
export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const cardNumber = (applicationId: string): string =>
  `FC-${applicationId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
