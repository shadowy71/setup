import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/constants';

/**
 * The old clubs board lived under Campus. Clubs now have their own section at
 * `/clubs`, so this address forwards there instead of showing a second,
 * slightly different list (one surface, no duplicated nav).
 */
export default async function LegacyClubsPage() {
  redirect(ROUTES.clubs);
}
