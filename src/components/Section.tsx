'use client';
import type { ReactNode } from 'react';
import { IconChevron } from './icons';

/** Collapsible panel step (native <details>, keyboard accessible). */
export default function Section({
  step,
  title,
  badge,
  defaultOpen = true,
  children,
}: {
  /** Step number shown in a small circle; omit for auxiliary sections. */
  step?: number;
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group border-t border-zinc-100 first:border-t-0">
      <summary className="flex cursor-pointer select-none list-none items-center gap-3 px-5 py-3.5 [&::-webkit-details-marker]:hidden">
        {step !== undefined ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-[10px] font-semibold text-white">
            {step}
          </span>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <span className="text-sm font-semibold text-zinc-900">{title}</span>
        <span className="ml-auto flex items-center gap-2">
          {badge}
          <IconChevron className="text-zinc-400 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="px-5 pb-5 text-sm">{children}</div>
    </details>
  );
}
