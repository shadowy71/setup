import { requireUser } from '@/lib/auth/session';

// Keep the protected route boundary independent of the optional shared shell.
export const dynamic = 'force-dynamic';
export default async function AppLayout({ children }) {
  await requireUser();
  return children;
}
