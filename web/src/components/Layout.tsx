import {
  CalendarClock, ClipboardList, CreditCard, FileSpreadsheet, GraduationCap, LogOut, Mail,
  Inbox, LayoutDashboard, PlusCircle, type LucideIcon,
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
  { to: '/staff/dashboard', label: 'Dashboard', icon: LayoutDashboard },
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

  // Desktop: the sidebar fills the left edge and stays put; only the content area scrolls.
  // Phone: the sidebar becomes a strip across the top and the page scrolls normally.
  return (
    <div className="min-h-screen bg-bg-secondary md:h-screen">
      <div className="app-shell flex min-h-screen flex-col bg-bg-secondary md:h-full md:min-h-0 md:flex-row md:overflow-hidden">
        <aside className="flex flex-col bg-side text-side-text md:w-72 md:shrink-0">
          <div className="flex items-center justify-between px-6 py-5 md:block md:px-9 md:pb-4 md:pt-8">
            <div className="font-display text-xl font-black tracking-widest text-side-active-text">FINESSE</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-side-muted md:mt-2">Campus Finance</div>
          </div>

          <nav aria-label="Main" className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-4 md:flex-1 md:flex-col md:gap-1.5 md:overflow-y-auto md:py-7 md:pl-6 md:pr-0">
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3.5 whitespace-nowrap rounded-md px-4 py-3 font-body text-sm font-medium md:rounded-r-none md:rounded-l-full md:py-3 md:pl-6 md:pr-4',
                    isActive ? 'nav-active' : 'text-side-muted hover:bg-side-hover hover:text-side-text md:mr-6',
                  )
                }
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden /> {label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden border-t border-side-line px-9 py-5 md:block">
            <div className="truncate font-body text-sm font-semibold">{user?.name}</div>
            <div className="mt-0.5 truncate font-body text-xs text-side-muted">{user?.email}</div>
            <div className="mt-2 text-[10px] uppercase tracking-[0.25em] text-side-accent">{user?.role}</div>
            <div className="mt-4 flex gap-2">
              <ThemeToggle className="border-side-line hover:border-side-active-text" />
              <button onClick={logout} className="flex flex-1 items-center justify-center gap-2 rounded-md border border-side-line px-3 text-xs font-bold uppercase hover:border-red-300 hover:text-red-300">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </aside>

        <main className="app-main min-w-0 flex-1 px-5 py-8 md:overflow-y-auto md:px-12 md:py-12 lg:px-16">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
          <div className="mt-10 flex gap-2 md:hidden">
            <ThemeToggle className="border-line" />
            <button onClick={logout} className="flex items-center gap-2 rounded-md border border-line px-3 text-xs font-bold uppercase">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
