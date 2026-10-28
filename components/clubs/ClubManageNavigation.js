import Link from 'next/link';
import { CLUB_MANAGE_VIEWS, ROUTES } from '@/lib/constants';
import { Icon } from '@/components/ui/icons';

/** Touch-friendly horizontal navigation on narrow screens, sidebar on desktop. */
export function ClubManageNavigation({ clubId, activeView }) {
  return (
    <nav aria-label="Club management views" className="card flex gap-1 overflow-x-auto p-2 lg:sticky lg:top-20 lg:flex-col lg:overflow-visible">
      {CLUB_MANAGE_VIEWS.map((view) => (
        <Link
          key={view.value}
          href={ROUTES.clubManage(clubId, view.value)}
          aria-current={activeView === view.value ? 'page' : undefined}
          data-active={activeView === view.value}
          className="chip min-h-9 shrink-0 whitespace-nowrap lg:w-full lg:justify-start"
        >
          <Icon name={view.icon} size={13} />{view.label}
        </Link>
      ))}
    </nav>
  );
}
