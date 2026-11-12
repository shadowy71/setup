'use client';

import { Icon } from '@/components/ui/icons';

const FEATURES = [
  { icon: 'send', title: 'Easy Navigation', body: 'Find your way' },
  { icon: 'landmark', title: 'Key Landmarks', body: 'Locate important spots' },
  { icon: 'mapPin', title: 'Campus Guide', body: 'Explore with ease' },
];

/** The landmark glyph: a columned institution, drawn for this strip only. */
function FeatureIcon({ icon }) {
  if (icon !== 'landmark') return <Icon name={icon} size={20} />;
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 9.5 12 4l9 5.5M4 10v8m4-8v8m4-8v8m4-8v8m4-8v8M3 20h18" />
    </svg>
  );
}

/**
 * The three-up feature strip under the directory: one container, three equal
 * sections divided by lit hairlines, orange glyphs over white titles and
 * muted secondary lines.
 */
export function CampusFeatureCards() {
  return (
    <section className="cm-feats" aria-label="Campus map features">
      {FEATURES.map((feature) => (
        <article key={feature.title} className="cm-feat">
          <span className="cm-feat__icon" aria-hidden="true">
            <FeatureIcon icon={feature.icon} />
          </span>
          <h3 className="cm-feat__title">{feature.title}</h3>
          <p className="cm-feat__body">{feature.body}</p>
        </article>
      ))}
    </section>
  );
}
