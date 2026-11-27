import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface SectionCardProps {
  title: ReactNode;
  titleExtra?: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  leading?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  interactive?: boolean;
  details?: ReactNode;
  detailsLabel?: string;
  detailsCollapseLabel?: string;
  detailsDefaultOpen?: boolean;
  detailsOpen?: boolean;
  onDetailsOpenChange?: (open: boolean) => void;
  detailsTriggerPlacement?: 'content' | 'header';
  className?: string;
  headerClassName?: string;
  contentClassName?: string;
  titleClassName?: string;
}

export function SectionCard({
  title,
  titleExtra,
  subtitle,
  icon: Icon,
  leading,
  actions,
  children,
  footer,
  interactive = false,
  details,
  detailsLabel = '详情',
  detailsCollapseLabel = '收起详情',
  detailsDefaultOpen = false,
  detailsOpen,
  onDetailsOpenChange,
  detailsTriggerPlacement = 'content',
  className,
  headerClassName,
  contentClassName,
  titleClassName,
}: SectionCardProps) {
  const [internalOpen, setInternalOpen] = useState(detailsDefaultOpen);
  const isControlled = detailsOpen !== undefined;
  const isOpen = isControlled ? detailsOpen : internalOpen;

  const hasDetails = details !== undefined && details !== null && details !== false;

  const handleToggleDetails = () => {
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onDetailsOpenChange?.(next);
  };

  const leadingNode =
    leading ??
    (Icon ? (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </div>
    ) : null);

  const headerDetailsButton =
    hasDetails && detailsTriggerPlacement === 'header' ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={isOpen}
        onClick={handleToggleDetails}
      >
        {isOpen ? (
          <>
            <ChevronUp className="size-4" aria-hidden="true" />
            <span>{detailsCollapseLabel}</span>
          </>
        ) : (
          <>
            <ChevronDown className="size-4" aria-hidden="true" />
            <span>{detailsLabel}</span>
          </>
        )}
      </Button>
    ) : null;

  const showContentDetails =
    hasDetails &&
    (detailsTriggerPlacement === 'content' || (detailsTriggerPlacement === 'header' && isOpen));

  const hasContent =
    (children !== undefined && children !== null && children !== false) || showContentDetails;

  return (
    <Card
      className={cn(
        'flex min-w-0 flex-col justify-between',
        interactive ? 'transition-colors hover:border-primary/40' : null,
        className,
      )}
    >
      <CardHeader className={cn('space-y-1.5 pb-3', headerClassName)}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            {leadingNode ? <div className="mt-0.5 shrink-0">{leadingNode}</div> : null}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className={cn('text-base leading-snug', titleClassName)}>
                  {title}
                </CardTitle>
                {titleExtra}
              </div>
              {subtitle ? (
                <CardDescription className="mt-1 break-words">{subtitle}</CardDescription>
              ) : null}
            </div>
          </div>

          {actions || headerDetailsButton ? (
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {actions}
              {headerDetailsButton}
            </div>
          ) : null}
        </div>
      </CardHeader>

      {hasContent ? (
        <CardContent className={cn('flex flex-1 flex-col gap-3.5', contentClassName)}>
          {children}

          {hasDetails && detailsTriggerPlacement === 'content' ? (
            <div className="space-y-1.5">
              <button
                type="button"
                onClick={handleToggleDetails}
                aria-expanded={isOpen}
                className="inline-flex items-center gap-1 rounded text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span>{isOpen ? detailsCollapseLabel : detailsLabel}</span>
                {isOpen ? (
                  <ChevronUp className="size-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                )}
              </button>
              {isOpen ? details : null}
            </div>
          ) : null}

          {hasDetails && detailsTriggerPlacement === 'header' && isOpen ? details : null}
        </CardContent>
      ) : null}

      {footer ? (
        <CardFooter className="pt-0 text-xs text-muted-foreground">{footer}</CardFooter>
      ) : null}
    </Card>
  );
}
