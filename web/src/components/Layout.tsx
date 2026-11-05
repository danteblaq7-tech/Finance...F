import {
  CalendarClock, ClipboardList, CreditCard, FileSpreadsheet, GraduationCap, LogOut, Mail,
  Inbox, PlusCircle, type LucideIcon,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { ThemeToggle } from '@/components/ThemeToggle';
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
  const nav = user?.role === 'student' ? STUDENT_NAV : STAFF_NAV;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-side-line bg-side text-side-text md:w-64 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-4 md:block">
          <div className="font-display text-lg font-black tracking-widest text-side-active-text">FINESSE</div>
          <div className="text-[10px] uppercase tracking-widest text-side-muted md:mt-1">Campus Finance</div>
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
                  isActive ? 'bg-side-active text-side-active-text' : 'text-side-muted hover:bg-side-hover hover:text-side-text',
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden border-t border-side-line p-4 md:block">
          <div className="truncate font-bold">{user?.name}</div>
          <div className="truncate text-xs text-side-muted">{user?.email}</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest text-side-accent">{user?.role}</div>
          <div className="mt-3 flex gap-2">
            <ThemeToggle className="border-side-line hover:border-side-active-text" />
            <button onClick={logout} className="flex flex-1 items-center justify-center gap-2 rounded-md border border-side-line px-3 text-xs font-bold uppercase hover:border-red-300 hover:text-red-300">
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
          <ThemeToggle className="border-line" />
          <button onClick={logout} className="flex items-center gap-2 rounded-md border border-line px-3 text-xs font-bold uppercase">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </main>
    </div>
  );
}
