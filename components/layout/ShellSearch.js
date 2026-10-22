'use client';

/**
 * Shell search entry — the Campus+ search pill in the desktop header.
 *
 * Submits to Explore (the real `global_search()` surface) and keeps the
 * keyboard habits a search box invites: "/" focuses it from anywhere, Escape
 * clears it. Nothing is fetched here — the results page owns the query.
 */

import { SearchField } from '@/components/ui/SearchField';
import { cn } from '@/lib/utils';

export function ShellSearch({ className = '' }) {
  return (
    <SearchField
      className={cn('w-full max-w-md', className)}
      hint="Search Campus+…"
      shortcut
    />
  );
}
