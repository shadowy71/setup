import { redirect } from 'next/navigation';

// Keep old bookmarks safe while retiring the first-visit guide.
export default function FormerGuide() {
  redirect('/');
}
