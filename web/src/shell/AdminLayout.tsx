import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/shell/auth-context';
import {
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  getVisibleMenuItems,
  matchRouteTrail,
  type NavRouteItem,
  type ShellBrand,
} from '@/shell/navigation';
import { Sidebar } from '@/shell/Sidebar';
import { Topbar } from '@/shell/Topbar';

export interface AdminLayoutProps {
  brand: ShellBrand;
  routes: readonly NavRouteItem[];
  loginPath?: string;
  notFoundTitle?: string;
}

function readInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function AdminLayout({
  brand,
  routes,
  loginPath = '/login',
  notFoundTitle = '页面未找到',
}: AdminLayoutProps) {
  const { username, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [signingOut, setSigningOut] = useState<boolean>(false);

  const menuItems = useMemo(() => getVisibleMenuItems(routes), [routes]);
  const breadcrumbs = useMemo(
    () => matchRouteTrail(routes, location.pathname),
    [routes, location.pathname],
  );

  const currentItem = breadcrumbs[breadcrumbs.length - 1];
  const pageTitle = currentItem?.title ?? notFoundTitle;

  useEffect(() => {
    document.title = `${pageTitle} - ${brand.name}`;
  }, [pageTitle, brand.name]);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // 忽略存储受限异常
      }
      return next;
    });
  }, []);

  const handleOpenMobileMenu = useCallback(() => {
    setMobileOpen(true);
  }, []);

  const handleCloseMobileMenu = useCallback(() => {
    setMobileOpen(false);
  }, []);

  const handleLogout = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate(loginPath, { replace: true });
    } finally {
      setSigningOut(false);
    }
  }, [signOut, navigate, loginPath]);

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-clip bg-muted/30 text-foreground">
      <Sidebar
        brand={brand}
        items={menuItems}
        collapsed={collapsed}
        onToggleCollapse={handleToggleCollapse}
        mobileOpen={mobileOpen}
        onCloseMobile={handleCloseMobileMenu}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          breadcrumbs={breadcrumbs}
          fallbackTitle={notFoundTitle}
          username={username}
          signingOut={signingOut}
          onOpenMobileMenu={handleOpenMobileMenu}
          onLogout={handleLogout}
        />

        <main className="min-w-0 flex-1 p-3 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
