import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface PosterImageProps {
  src: string | null;
  title: string;
  className?: string;
  textClassName?: string;
}

function getTitleInitial(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return '影';
  return Array.from(trimmed)[0] ?? '影';
}

export function PosterImage({ src, title, className, textClassName }: PosterImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;
  const initial = getTitleInitial(title);

  return (
    <div
      className={cn(
        'relative aspect-[2/3] w-full overflow-hidden rounded-lg border border-border/60 bg-muted',
        className,
      )}
    >
      {showImage && src ? (
        <img
          src={src}
          alt={title}
          loading="lazy"
          onError={() => setFailedSrc(src)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className={cn(
            'flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/60 font-semibold text-muted-foreground select-none',
            textClassName ?? 'text-2xl',
          )}
          aria-label={`${title} 海报占位`}
        >
          {initial}
        </div>
      )}
    </div>
  );
}
