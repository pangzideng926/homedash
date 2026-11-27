import { Command, Monitor, Terminal } from 'lucide-react';
import type { DetectedOs, DeviceOsConfig } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface DeviceOsIconProps {
  os: DetectedOs | DeviceOsConfig;
  className?: string;
}

export function DeviceOsIcon({ os, className }: DeviceOsIconProps) {
  if (os === 'windows') {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden="true"
        data-os="windows"
        className={cn('size-4 text-sky-500', className)}
      >
        <rect x="1.5" y="1.5" width="5.75" height="5.75" rx="0.75" />
        <rect x="8.75" y="1.5" width="5.75" height="5.75" rx="0.75" />
        <rect x="1.5" y="8.75" width="5.75" height="5.75" rx="0.75" />
        <rect x="8.75" y="8.75" width="5.75" height="5.75" rx="0.75" />
      </svg>
    );
  }

  if (os === 'macos') {
    return (
      <Command
        aria-hidden="true"
        data-os="macos"
        className={cn('size-4 text-foreground', className)}
      />
    );
  }

  if (os === 'linux') {
    return (
      <Terminal
        aria-hidden="true"
        data-os="linux"
        className={cn('size-4 text-amber-500', className)}
      />
    );
  }

  return (
    <Monitor
      aria-hidden="true"
      data-os={os === 'auto' ? 'unknown' : os}
      className={cn('size-4 text-muted-foreground', className)}
    />
  );
}
