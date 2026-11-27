import { useEffect } from 'react';
import { LayoutGrid, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { NavLink } from 'react-router';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { NavRouteItem, ShellBrand } from '@/shell/navigation';

export interface SidebarProps {
  brand: ShellBrand;
  items: readonly NavRouteItem[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface SidebarMenuListProps {
  items: readonly NavRouteItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}

function SidebarMenuList({ items, collapsed, onNavigate }: SidebarMenuListProps) {
  return (
    <div className="space-y-4">
      {items.map((item) => {
        if (item.children?.length && !item.path) {
          return (
            <div key={item.id} className="space-y-1">
              {collapsed ? (
                <Separator className="my-2" />
              ) : (
                <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">
                  {item.title}
                </div>
              )}
              <div className="space-y-1">
                {item.children.map((child) => (
                  <SidebarMenuLink
                    key={child.id}
                    item={child}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          );
        }

        return (
          <div key={item.id} className="space-y-1">
            {item.path ? (
              <SidebarMenuLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
            ) : null}
            {item.children?.length ? (
              <div className={cn('space-y-1', !collapsed && 'pl-3')}>
                {item.children.map((child) => (
                  <SidebarMenuLink
                    key={child.id}
                    item={child}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

interface SidebarMenuLinkProps {
  item: NavRouteItem;
  collapsed: boolean;
  onNavigate?: () => void;
}

function SidebarMenuLink({ item, collapsed, onNavigate }: SidebarMenuLinkProps) {
  if (!item.path) {
    return null;
  }

  const Icon = item.icon;

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      aria-label={item.title}
      title={collapsed ? item.title : undefined}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center rounded-md py-2 text-sm font-medium transition-colors',
          collapsed ? 'justify-center px-2' : 'gap-3 px-3',
          isActive
            ? 'bg-primary text-primary-foreground shadow-xs'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )
      }
    >
      {Icon ? <Icon className="size-4 shrink-0" aria-hidden="true" /> : null}
      {collapsed ? (
        <span className="sr-only">{item.title}</span>
      ) : (
        <span className="truncate">{item.title}</span>
      )}
    </NavLink>
  );
}

export function Sidebar({
  brand,
  items,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const BrandIcon = brand.icon ?? LayoutGrid;

  useEffect(() => {
    if (!mobileOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseMobile();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  return (
    <>
      <aside
        data-testid="desktop-sidebar"
        data-collapsed={collapsed ? 'true' : 'false'}
        className={cn(
          'hidden shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 md:flex',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div
          className={cn(
            'flex h-16 items-center',
            collapsed ? 'justify-center px-2' : 'gap-2.5 px-5',
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BrandIcon className="size-4" aria-hidden="true" />
          </div>
          {!collapsed ? (
            <div className="min-w-0">
              <div className="truncate text-base font-semibold tracking-tight">{brand.name}</div>
              {brand.subtitle ? (
                <div className="truncate text-xs text-muted-foreground">{brand.subtitle}</div>
              ) : null}
            </div>
          ) : null}
        </div>

        <Separator />

        <nav aria-label="主导航" className="flex-1 overflow-y-auto p-3">
          <SidebarMenuList items={items} collapsed={collapsed} />
        </nav>

        <Separator />

        <div className="p-2">
          <Button
            type="button"
            variant="ghost"
            size={collapsed ? 'icon' : 'sm'}
            onClick={onToggleCollapse}
            aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
            className={cn('w-full', !collapsed && 'justify-start gap-2')}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose className="size-4" aria-hidden="true" />
                <span>收起菜单</span>
              </>
            )}
          </Button>
        </div>
      </aside>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-50 flex md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="导航菜单"
        >
          <div
            data-testid="sidebar-backdrop"
            aria-hidden="true"
            className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={onCloseMobile}
          />
          <aside className="relative z-10 flex w-64 max-w-[80vw] flex-col border-r border-border bg-card shadow-xl">
            <div className="flex h-16 items-center justify-between px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <BrandIcon className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-semibold tracking-tight">
                    {brand.name}
                  </div>
                  {brand.subtitle ? (
                    <div className="truncate text-xs text-muted-foreground">{brand.subtitle}</div>
                  ) : null}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="关闭导航菜单"
                onClick={onCloseMobile}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <Separator />

            <nav aria-label="移动端主导航" className="flex-1 overflow-y-auto p-3">
              <SidebarMenuList items={items} collapsed={false} onNavigate={onCloseMobile} />
            </nav>
          </aside>
        </div>
      ) : null}
    </>
  );
}
