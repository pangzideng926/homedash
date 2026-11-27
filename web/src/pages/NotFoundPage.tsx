import { FileQuestion } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-3">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileQuestion className="size-6" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <div className="text-3xl font-bold tracking-tight text-foreground">404</div>
            <CardTitle className="text-lg">页面未找到</CardTitle>
            <CardDescription>您访问的页面不存在或已被移除，请检查地址是否正确。</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Link to="/">
            <Button type="button">返回首页</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export default NotFoundPage;
