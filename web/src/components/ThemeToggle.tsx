import { Moon, Sun } from 'lucide-react';
import { setTheme, useIsDark } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** Light/dark switch. Pass colour classes (border, hover) so it suits wherever it is placed. */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useIsDark();
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button type="button" onClick={() => setTheme(!dark)} aria-label={label} title={label} className={cn('rounded-md border p-2', className)}>
      {dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
    </button>
  );
}
