import localFont from 'next/font/local';
import '@/app/styles/login.css';

/**
 * The display face, scoped to the sign-in route group.
 *
 * Boldonse (75 kB) is used by exactly one selector — `.login-title` in
 * app/styles/login.css. Declaring it here instead of in the root layout means
 * `next/font` emits its `<link rel=preload>` only for `/login` (and
 * `/login/verify`), instead of asking every page in the product to preload a
 * face it never renders. The CSS variable still reaches `.login-title` because
 * this wrapper is an ancestor of the page.
 */
const displayFont = localFont({
  src: '../fonts/Boldonse-Regular.ttf',
  variable: '--font-display',
  display: 'swap',
});

export default function LoginLayout({ children }) {
  return <div className={displayFont.variable}>{children}</div>;
}
