import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import type { NavRouteItem } from '@/shell/navigation';

export interface BreadcrumbsProps {
  items: readonly NavRouteItem[];
  fallbackTitle?: string;
}

export function Breadcrumbs({ items, fallbackTitle = '页面未找到' }: BreadcrumbsProps) {
  if (items.length === 0) {
    return (
      <nav aria-label="面包屑" className="flex min-w-0 items-center text-sm">
        <ol className="flex min-w-0 items-center gap-1.5">
          <li aria-current="page" className="truncate font-semibold text-foreground">
            {fallbackTitle}
          </li>
        </ol>
      </nav>
    );
  }

  return (
    <nav aria-label="面包屑" className="flex min-w-0 items-center text-sm">
      <ol className="flex min-w-0 items-center gap-1.5">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <Fragment key={item.id}>
              {index > 0 ? (
                <li aria-hidden="true" className="shrink-0 text-muted-foreground">
                  <ChevronRight className="size-3.5" />
                </li>
              ) : null}
              <li className="min-w-0 truncate">
                {isLast ? (
                  <span aria-current="page" className="font-semibold text-foreground">
                    {item.title}
                  </span>
                ) : item.path ? (
                  <Link
                    to={item.path}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item.title}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">{item.title}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
