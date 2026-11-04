import { notFound } from 'next/navigation';
import GalacticIntro from '@/components/layout/GalacticIntro';

// A local-only preview for reviewing the home intro without a signed-in session.
export default function IntroPreview() {
  if (process.env.NODE_ENV !== 'development') notFound();

  return (
    <GalacticIntro>
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', textAlign: 'center', padding: '2rem' }}>
        <div>
          <h1>Intro complete</h1>
          <p>Refresh this page to replay the animation.</p>
        </div>
      </main>
    </GalacticIntro>
  );
}
