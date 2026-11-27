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
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="打开导航菜单"
          onClick={onOpenMobileMenu}
          className="md:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>

        <Breadcrumbs items={breadcrumbs} fallbackTitle={fallbackTitle} />
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <ThemeToggle />

        <div className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
          <User className="size-4" aria-hidden="true" />
          <span>{username ?? '管理员'}</span>
        </div>

        <Button type="button" variant="outline" size="sm" onClick={onLogout} disabled={signingOut}>
          <LogOut className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">{signingOut ? '退出中...' : '退出登录'}</span>
        </Button>
      </div>
    </header>
  );
}
