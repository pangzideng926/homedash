import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CardGridColumns = 2 | 3 | 4;

export interface CardGridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: CardGridColumns;
  children: ReactNode;
}

const GRID_COLUMNS_CLASS: Record<CardGridColumns, string> = {
  2: 'grid-cols-1 lg:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
};

export function CardGrid({ columns = 3, className, children, ...props }: CardGridProps) {
  return (
    <div
      className={cn('grid gap-4 [&>*]:min-w-0', GRID_COLUMNS_CLASS[columns], className)}
      {...props}
    >
      {children}
    </div>
  );
}
