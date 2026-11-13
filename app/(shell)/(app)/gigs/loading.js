import { LoadingPanel } from '@/components/ui';

/** Route loading state for the gig board — same skeleton language as every page. */
export default function GigsLoading() {
  return <LoadingPanel words={['gigs', 'open work', 'applications', 'skills']} rows={5} />;
}
