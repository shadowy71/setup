import Link from 'next/link';
import RetroErrorIllustration from './RetroErrorIllustration';
import styles from './RetroErrorPage.module.css';

export default function RetroErrorPage({ runtime = false, reset }) {
  return (
    <section className={styles.page} aria-labelledby="error-heading">
      <div className={styles.brand}>CAMPUS<span>+</span></div>
      <RetroErrorIllustration signal={runtime ? 'SIGNAL LOST' : 'NOT FOUND'} showDigits={!runtime} />
      <div className={styles.copy}>
        <p className={styles.eyebrow}>{runtime ? 'A momentary interruption' : '404 / Page not found'}</p>
        <h1 id="error-heading">{runtime ? 'Something went wrong.' : 'This page went off the air.'}</h1>
        <p className={styles.description}>{runtime ? 'This page could not be loaded. Please try again.' : 'The link might be outdated, or this page may no longer exist. Let’s get you back on track.'}</p>
        {runtime ? <button className={styles.action} type="button" onClick={reset}>Retry</button> : <Link className={styles.action} href="/">Back to Campus+</Link>}
        <p className={styles.footer}>Return to a familiar frequency.</p>
      </div>
    </section>
  );
}
