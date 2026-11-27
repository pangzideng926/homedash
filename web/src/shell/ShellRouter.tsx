import { Suspense, useEffect, useMemo, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { LoadingState } from '@/components/common/LoadingState';
import { AdminLayout } from '@/shell/AdminLayout';
import { ProtectedRoute } from '@/shell/ProtectedRoute';
import { flattenRoutes, type NavRouteItem, type ShellBrand } from '@/shell/navigation';

export interface ShellRouterProps {
  brand: ShellBrand;
  routes: readonly NavRouteItem[];
  notFoundComponent?: ComponentType;
  loginPath?: string;
  notFoundTitle?: string;
}

interface RoutePageWrapperProps {
  title: string;
  brandName: string;
  component: ComponentType;
}

function RoutePageWrapper({ title, brandName, component: Component }: RoutePageWrapperProps) {
  useEffect(() => {
    document.title = `${title} - ${brandName}`;
  }, [title, brandName]);

  return (
    <Suspense fallback={<LoadingState />}>
      <Component />
    </Suspense>
  );
}

export function ShellRouter({
  brand,
  routes,
  notFoundComponent: NotFoundComponent,
  loginPath = '/login',
  notFoundTitle = '页面未找到',
}: ShellRouterProps) {
  const flatRoutes = useMemo(() => flattenRoutes(routes), [routes]);
  const publicRoutes = useMemo(
    () => flatRoutes.filter((route) => !route.requiresAuth),
    [flatRoutes],
  );
  const protectedRoutes = useMemo(
    () => flatRoutes.filter((route) => route.requiresAuth),
    [flatRoutes],
  );

  return (
    <Routes>
      {publicRoutes.map((route) => (
        <Route
          key={route.item.id}
          path={route.path}
          element={
            <RoutePageWrapper
              title={route.item.title}
              brandName={brand.name}
              component={route.component}
            />
          }
        />
      ))}

      <Route element={<ProtectedRoute loginPath={loginPath} />}>
        <Route
          element={
            <AdminLayout
              brand={brand}
              routes={routes}
              loginPath={loginPath}
              notFoundTitle={notFoundTitle}
            />
          }
        >
          {protectedRoutes.map((route) => {
            const Component = route.component;
            return (
              <Route
                key={route.item.id}
                path={route.path}
                element={
                  <Suspense fallback={<LoadingState />}>
                    <Component />
                  </Suspense>
                }
              />
            );
          })}
          <Route
            path="*"
            element={
              NotFoundComponent ? (
                <Suspense fallback={<LoadingState />}>
                  <NotFoundComponent />
                </Suspense>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
        </Route>
      </Route>
    </Routes>
  );
}
