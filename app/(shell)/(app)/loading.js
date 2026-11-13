import { Spinner } from '@/components/ui';

export default function Loading() {
  return (
    <div className="route-loading flex min-h-[50vh] items-center justify-center">
      <Spinner label="Loading Campus+…" />
    </div>
  );
}
