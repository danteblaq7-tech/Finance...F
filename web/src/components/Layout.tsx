import {
  CalendarClock, ClipboardList, CreditCard, FileSpreadsheet, GraduationCap, LogOut, Mail, Moon,
  Inbox, PlusCircle, Sun, type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/features/auth/AuthProvider';
import { cn } from '@/lib/utils';

interface NavItem { to: string; label: string; icon: LucideIcon }

const STUDENT_NAV: NavItem[] = [
  { to: '/tickets', label: 'My Tickets', icon: ClipboardList },
  { to: '/tickets/new', label: 'Raise Ticket', icon: PlusCircle },
  { to: '/exam-card', label: 'Exam Card', icon: CreditCard },
];

const STAFF_NAV: NavItem[] = [
  { to: '/staff/queue', label: 'Ticket Queue', icon: Inbox },
  { to: '/staff/applications', label: 'Exam Applications', icon: GraduationCap },
  { to: '/staff/fee-records', label: 'Fee Records', icon: FileSpreadsheet },
  { to: '/staff/exam-periods', label: 'Exam Periods', icon: CalendarClock },
  { to: '/staff/slots', label: 'Appointment Slots', icon: CalendarClock },
  { to: '/staff/templates', label: 'Email Templates', icon: Mail },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const nav = user?.role === 'student' ? STUDENT_NAV : STAFF_NAV;

  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('finesse_theme', next ? 'dark' : 'light');
    setDark(next);
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-line bg-bg-secondary md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div className="font-display text-lg font-black tracking-widest text-brand-teal-lt">FINESSE</div>
          <div className="text-[10px] uppercase tracking-widest text-ink-muted md:mt-1">Campus Finance</div>
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wider',
                  isActive ? 'bg-brand-teal/20 text-brand-teal-lt' : 'text-ink-secondary hover:bg-bg-tertiary',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-line p-4 md:block">
          <div className="truncate font-bold">{user?.name}</div>
          <div className="truncate text-xs text-ink-muted">{user?.email}</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-brand-orange">{user?.role}</div>
          <div className="mt-3 flex gap-2">
            <button onClick={toggleTheme} aria-label="Toggle theme" className="rounded-md border border-line p-2 hover:border-line-active">
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button onClick={logout} className="flex flex-1 items-center justify-center gap-2 rounded-md border border-line px-3 text-xs font-bold uppercase hover:border-brand-red hover:text-brand-red">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8">
        <div className="mx-auto max-w-5xl">
          <Outlet />
        </div>
        <div className="mt-8 flex gap-2 md:hidden">
          <button onClick={toggleTheme} aria-label="Toggle theme" className="rounded-md border border-line p-2">
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button onClick={logout} className="flex items-center gap-2 rounded-md border border-line px-3 text-xs font-bold uppercase">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </main>
    </div>
  );
}
