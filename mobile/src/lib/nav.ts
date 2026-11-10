import type { ComponentProps } from 'react';
import type Ionicons from '@expo/vector-icons/Ionicons';
import type { UserRole } from './types';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export interface NavItem { href: string; label: string; icon: IconName }

// The same menus as the web app's side panel (web/src/components/Layout.tsx), in the same order.
// Email Templates is left out: it is an HTML editor that only makes sense on a computer.
const STUDENT: NavItem[] = [
  { href: '/tickets', label: 'My Tickets', icon: 'clipboard-outline' },
  { href: '/tickets/new', label: 'Raise Ticket', icon: 'add-circle-outline' },
  { href: '/exam', label: 'Exam Card', icon: 'card-outline' },
];
const LECTURER: NavItem[] = [
  { href: '/scan', label: 'Scan Cards', icon: 'scan-outline' },
  { href: '/units', label: 'My Units', icon: 'checkbox-outline' },
];
const STAFF: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'grid-outline' },
  { href: '/queue', label: 'Ticket Queue', icon: 'file-tray-outline' },
  { href: '/applications', label: 'Exam Applications', icon: 'school-outline' },
  { href: '/fees', label: 'Fee Records', icon: 'document-text-outline' },
  { href: '/periods', label: 'Exam Periods', icon: 'calendar-outline' },
  { href: '/slots', label: 'Appointment Slots', icon: 'time-outline' },
  { href: '/scan', label: 'Scan Cards', icon: 'scan-outline' },
  { href: '/units', label: 'Exam Units', icon: 'checkbox-outline' },
];
const ACCOUNT: NavItem = { href: '/profile', label: 'Account', icon: 'person-circle-outline' };

export function navFor(role: UserRole): NavItem[] {
  return [...(role === 'student' ? STUDENT : role === 'lecturer' ? LECTURER : STAFF), ACCOUNT];
}

/** Where each role lands after signing in. */
export const homeFor = (role: UserRole): string => (role === 'student' ? '/tickets' : role === 'lecturer' ? '/scan' : '/queue');

/** The menu item a path belongs to: the longest matching prefix, so /tickets/new lights "Raise Ticket" and /tickets/abc lights "My Tickets". */
export function activeItem(items: NavItem[], pathname: string): NavItem | undefined {
  return items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
