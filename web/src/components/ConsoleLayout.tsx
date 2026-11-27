import { useState } from 'react';
import { LogOut, ServerCog, User } from 'lucide-react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { NAV_ITEMS } from '@/config/navigation';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';

export function ConsoleLayout() {
  const { username, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  const currentNav = NAV_ITEMS.find((item) => item.path === location.pathname) ?? NAV_ITEMS[0];

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/login', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-muted/30 text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ServerCog className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold tracking-tight">homedash</div>
            <div className="truncate text-xs text-muted-foreground">家庭服务器控制台</div>
          </div>
        </div>

        <Separator />

        <nav aria-label="主导航" className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
          <h1 className="text-lg font-semibold tracking-tight">{currentNav?.label ?? '总览'}</h1>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="size-4" />
              <span>{username ?? '管理员'}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout} disabled={signingOut}>
              <LogOut className="size-4" />
              <span>{signingOut ? '退出中...' : '退出登录'}</span>
            </Button>
          </div>
        </header>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
