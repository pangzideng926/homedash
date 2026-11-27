import { Clock } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/common';

export interface ComingSoonPageProps {
  title: string;
  description: string;
}

export function ComingSoonPage({ title, description }: ComingSoonPageProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Clock}
        title="即将上线"
        description="该功能模块正在建设中，敬请期待。"
        className="max-w-2xl"
      />
    </div>
  );
}

export default ComingSoonPage;
