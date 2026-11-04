import type { UserRole } from './types';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** The API returns wall-clock strings like "2026-10-17 10:00:00". Parse them as local time. */
export function parseWall(s: string): Date {
  return new Date(s.includes('T') ? s : s.replace(' ', 'T'));
}

export function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  return parseWall(s).toLocaleString('en-KE', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '—';
  return parseWall(s).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatTime(s: string): string {
  return parseWall(s).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', hour12: true });
}

export function formatKsh(n: number): string {
  return `KSh ${Number(n).toLocaleString('en-KE')}`;
}

/** Local-calendar YYYY-MM-DD (not UTC), so "today" matches the user's wall clock. */
export function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Replace {{var}} placeholders. Values are HTML-escaped so user data can't inject markup. */
export function renderTemplate(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) => escapeHtml(String(vars[key] ?? '')));
}

export const cardNumber = (applicationId: string): string => `FC-${applicationId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export const homeFor = (role: UserRole): string => (role === 'student' ? '/tickets' : '/staff/queue');
