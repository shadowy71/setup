import { LoadingPanel } from '@/components/ui';

/** Route loading state for club discovery — same skeleton language as every page. */
export default function ClubsLoading() {
  return <LoadingPanel words={['clubs', 'categories', 'members', 'events']} rows={4} />;
}
