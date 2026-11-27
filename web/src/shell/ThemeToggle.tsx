import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type ThemeMode } from '@/shell/theme-context';

interface ThemeOption {
  value: ThemeMode;
  label: string;
  ariaLabel: string;
  icon: LucideIcon;
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: '亮色', ariaLabel: '亮色主题', icon: Sun },
  { value: 'dark', label: '暗色', ariaLabel: '暗色主题', icon: Moon },
  { value: 'system', label: '系统', ariaLabel: '跟随系统', icon: Monitor },
];

export interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="主题切换"
      className={cn(
        'inline-flex items-center rounded-lg border border-border bg-muted/60 p-0.5',
        className,
      )}
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={active}
            title={option.ariaLabel}
            onClick={() => setTheme(option.value)}
            className={cn(
              'inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-xs'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
