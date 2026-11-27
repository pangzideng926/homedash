import { Navigate, Outlet, useLocation } from 'react-router';
import { LoadingState } from '@/components/common/LoadingState';
import { useAuth } from '@/shell/auth-context';
import { buildLoginUrl } from '@/shell/navigation';

export interface ProtectedRouteProps {
  loginPath?: string;
}

export function ProtectedRoute({ loginPath = '/login' }: ProtectedRouteProps) {
  const { status, sessionExpired } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <LoadingState
          message="正在验证登录状态..."
          className="w-full max-w-xs border-none bg-transparent"
        />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    const fromPath = `${location.pathname}${location.search}`;
    return (
      <Navigate to={buildLoginUrl(fromPath, { loginPath, expired: sessionExpired })} replace />
    );
  }

  return <Outlet />;
}
