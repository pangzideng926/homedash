import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { matchPath } from 'react-router';

export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sidebar-collapsed';

export interface ShellBrand {
  name: string;
  subtitle?: string;
  icon?: LucideIcon;
}

export interface NavRouteItem {
  id: string;
  path?: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  component?: ComponentType;
  requiresAuth?: boolean;
  hiddenInMenu?: boolean;
  children?: NavRouteItem[];
}

export interface FlattenedRoute {
  item: NavRouteItem;
  path: string;
  component: ComponentType;
  requiresAuth: boolean;
  parents: NavRouteItem[];
}

/**
 * 递归展开路由配置树，提取所有可注册的页面路由。
 */
export function flattenRoutes(
  items: readonly NavRouteItem[],
  parents: readonly NavRouteItem[] = [],
): FlattenedRoute[] {
  const result: FlattenedRoute[] = [];

  for (const item of items) {
    if (item.path && item.component) {
      result.push({
        item,
        path: item.path,
        component: item.component,
        requiresAuth: item.requiresAuth ?? true,
        parents: [...parents],
      });
    }

    if (item.children?.length) {
      result.push(...flattenRoutes(item.children, [...parents, item]));
    }
  }

  return result;
}

/**
 * 过滤掉菜单中隐藏的节点和空分组，用于侧栏菜单渲染。
 */
export function getVisibleMenuItems(items: readonly NavRouteItem[]): NavRouteItem[] {
  const visible: NavRouteItem[] = [];

  for (const item of items) {
    if (item.hiddenInMenu) {
      continue;
    }

    if (item.children?.length) {
      const visibleChildren = getVisibleMenuItems(item.children);
      if (visibleChildren.length > 0 || item.path) {
        visible.push({
          ...item,
          children: visibleChildren,
        });
      }
      continue;
    }

    if (item.path) {
      visible.push(item);
    }
  }

  return visible;
}

/**
 * 根据当前 pathname 匹配导航配置中的完整层级路径（用于面包屑和页面标题）。
 */
export function matchRouteTrail(items: readonly NavRouteItem[], pathname: string): NavRouteItem[] {
  for (const item of items) {
    if (item.path && matchPath({ path: item.path, end: true }, pathname)) {
      return [item];
    }

    if (item.children?.length) {
      const childTrail = matchRouteTrail(item.children, pathname);
      if (childTrail.length > 0) {
        return [item, ...childTrail];
      }
    }
  }

  return [];
}

/**
 * 校验并规范化登录后回跳路径，防止开放重定向或死循环跳回登录页。
 */
export function getSafeRedirectPath(raw: string | null, loginPath = '/login'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) {
    return '/';
  }
  const pathname = raw.split('?')[0]?.split('#')[0] ?? '/';
  if (pathname === loginPath) {
    return '/';
  }
  return raw;
}

/**
 * 构造带 redirect 与过期原因参数的登录页地址。
 */
export function buildLoginUrl(
  fromPath: string,
  options?: { loginPath?: string; expired?: boolean },
): string {
  const loginPath = options?.loginPath ?? '/login';
  const params = new URLSearchParams();
  const safeFrom = getSafeRedirectPath(fromPath, loginPath);
  if (safeFrom !== '/') {
    params.set('redirect', safeFrom);
  } else if (fromPath === '/') {
    params.set('redirect', '/');
  }

  if (options?.expired) {
    params.set('reason', 'expired');
  }

  const query = params.toString();
  return query ? `${loginPath}?${query}` : loginPath;
}
