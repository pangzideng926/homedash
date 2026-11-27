import { useState, type FormEvent } from 'react';
import { ServerCog } from 'lucide-react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { ThemeToggle, getSafeRedirectPath, useAuth } from '@/shell';

export function LoginPage() {
  const { status, sessionExpired, signIn, clearSessionExpired } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectTarget = getSafeRedirectPath(searchParams.get('redirect'));
  const isExpiredNotice =
    !errorMessage && (searchParams.get('reason') === 'expired' || sessionExpired);

  if (status === 'authenticated') {
    return <Navigate to={redirectTarget} replace />;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    clearSessionExpired();

    if (!username.trim() || !password) {
      setErrorMessage('请输入用户名和密码');
      return;
    }

    setSubmitting(true);
    try {
      await signIn(username.trim(), password);
      navigate(redirectTarget, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('登录失败，请检查网络连接');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-x-clip bg-muted/40 px-4 pt-16 pb-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <ServerCog className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <CardTitle className="text-xl">登录控制台</CardTitle>
            <CardDescription>homedash 家庭服务器控制台</CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {isExpiredNotice ? (
              <div
                role="status"
                className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400"
              >
                登录已过期，请重新登录
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="请输入用户名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
            </div>

            {errorMessage ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {errorMessage}
              </div>
            ) : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? '登录中...' : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default LoginPage;
