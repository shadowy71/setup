import styles from './OnboardingIntro.module.css';

const NOTES = [
  ['Find the useful stuff again', 'Search questions, resources, events and opportunities long after the chat moves on.'],
  ['Do more than scroll', 'Join communities, find teammates, explore listings or help return a lost thing.'],
  ['Keep it human', 'Campus-focused access. A public @username; your email stays private from other students. Reports go to human moderators.'],
];

const DESTINATIONS = [
  ['Home', 'Campus discussions and feed.'],
  ['Explore', 'Search, resources, projects, opportunities.'],
  ['Communities', 'Clubs, interest groups and study groups.'],
  ['Campus', 'Events and practical campus utilities.'],
  ['Market', 'Student listings and gigs.'],
  ['Chat', 'Conversations with other students.'],
];

/** Static field notes, mounted only after the onboarding page's auth guards. */
export function OnboardingIntro() {
  return (
    <section className={styles.intro} aria-labelledby="onboarding-heading">
      <p className={styles.eyebrow}>A note for campus life</p>
      <h2 id="onboarding-heading" className={styles.heading}>
        Campus life, a little less <span className={styles.underline}>scattered.</span>
      </h2>
      <p className={styles.opening}>
        Campus information shouldn&apos;t disappear up a chat. Campus+ gives PCCOE conversations,
        communities and practical student stuff a searchable home.
      </p>

      <ol className={styles.notes} aria-label="Why Campus+">
        {NOTES.map(([title, description], index) => (
          <li key={title} className={styles.note}>
            <span className={styles.number} aria-hidden="true">0{index + 1}</span>
            <h3>{title}</h3>
            <p>{description}</p>
          </li>
        ))}
      </ol>

      <section className={styles.guide} aria-labelledby="onboarding-guide-heading">
        <h3 id="onboarding-guide-heading">Where do I go first?</h3>
        <dl className={styles.destinations}>
          {DESTINATIONS.map(([name, description]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.firstStep}>
          <span aria-hidden="true" className={styles.arrow}>↳</span>
          After your profile, you&apos;ll land on Home. Read a discussion or ask your first campus question.
        </p>
      </section>
    </section>
  );
}
