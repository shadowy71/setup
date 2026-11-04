import styles from './RetroErrorIllustration.module.css';

// Adapted from Praashoo7's MIT-licensed Uiverse card, inspired by Stefan Devai.
// The entire illustration is decorative; the page supplies the accessible message.
export default function RetroErrorIllustration({ signal = 'NOT FOUND', showDigits = true }) {
  return (
    <div className={styles.wrapper} aria-hidden="true">
      {showDigits && <div className={styles.digits}>404</div>}
      <div className={styles.main}>
        <div className={styles.antenna}>
          <div className={styles.antennaShadow} />
          <div className={styles.a1} /><div className={styles.a1d} />
          <div className={styles.a2} /><div className={styles.a2d} />
          <div className={styles.antennaBase} />
        </div>
        <div className={styles.tv}>
          <div className={styles.curve}>
            <svg className={styles.curveSvg} version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 189.929 189.929" xmlSpace="preserve">
              <path d="M70.343,70.343c-30.554,30.553-44.806,72.7-39.102,115.635l-29.738,3.951C-5.442,137.659,11.917,86.34,49.129,49.13 C86.34,11.918,137.664-5.445,189.928,1.502l-3.95,29.738C143.041,25.54,100.895,39.789,70.343,70.343z" />
            </svg>
          </div>
          <div className={styles.display}><div className={styles.screenOuter}><div className={styles.screenFrame}>
            <div className={styles.screen}><span className={styles.screenText}>{signal}</span></div>
          </div></div></div>
          <div className={styles.lines}><div /><div /><div /></div>
          <div className={styles.controls}>
            <div className={styles.knob1}><div /></div><div className={styles.knob2} />
            <div className={styles.speakers}><div className={styles.speakerDots}><div /><div /><div /></div><div className={styles.grille} /><div className={styles.grille} /></div>
          </div>
        </div>
        <div className={styles.bottom}><div className={styles.base1} /><div className={styles.base2} /><div className={styles.base3} /></div>
      </div>
    </div>
  );
}
