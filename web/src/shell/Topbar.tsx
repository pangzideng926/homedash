import { LogOut, Menu, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Breadcrumbs } from '@/shell/Breadcrumbs';
import type { NavRouteItem } from '@/shell/navigation';
import { ThemeToggle } from '@/shell/ThemeToggle';

export interface TopbarProps {
  breadcrumbs: readonly NavRouteItem[];
  fallbackTitle?: string;
  username: string | null;
  signingOut: boolean;
  onOpenMobileMenu: () => void;
  onLogout: () => void;
}

export function Topbar({
  breadcrumbs,
  fallbackTitle,
  username,
  signingOut,
  onOpenMobileMenu,
  onLogout,
}: TopbarProps) {
  return (
    <header className="flex min-h-14 w-full shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:min-h-16 sm:gap-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="打开导航菜单"
          onClick={onOpenMobileMenu}
          className="shrink-0 md:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>

        <Breadcrumbs items={breadcrumbs} fallbackTitle={fallbackTitle} />
      </div>

      <div className="flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
        <ThemeToggle />

        <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
          <User className="size-4" aria-hidden="true" />
          <span>{username ?? '管理员'}</span>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onLogout}
          disabled={signingOut}
          aria-label={signingOut ? '退出中...' : '退出登录'}
          title={signingOut ? '退出中...' : '退出登录'}
          className="px-2 sm:px-3"
        >
          <LogOut className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{signingOut ? '退出中...' : '退出登录'}</span>
        </Button>
      </div>
    </header>
  );
}
