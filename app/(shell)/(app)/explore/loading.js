import { LoadingPanel } from '@/components/ui';

/**
 * Route loading state: the same skeleton language as every other page — a title
 * placeholder, the word loader and the list that is about to arrive — so waiting
 * never looks like a different product.
 */
export default function ExploreLoading() {
  return <LoadingPanel words={['campus', 'communities', 'listings', 'events', 'discussions']} rows={5} />;
}
