import { serializeJsonLd } from '@/lib/seo';

// React renders script text as text content. Escape HTML-significant characters
// before rendering so untrusted record fields cannot terminate the script.
export default function JsonLd({ value }) {
  if (!value) return null;
  return <script type="application/ld+json">{serializeJsonLd(value)}</script>;
}
