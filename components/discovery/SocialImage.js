// ImageResponse has no document CSS variables; use the dark Lumen sRGB tokens.
// Content is from anonymous records only.
export function SocialImage({ kind, title, subtitle, description, initials, hue = 30 }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: 'rgb(25, 29, 33)', color: 'rgb(241, 235, 229)', padding: '64px 78px', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', color: 'rgb(199, 174, 146)', fontSize: 26, fontWeight: 700, letterSpacing: 4 }}>CAMPUS+</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        {initials ? <div style={{ display: 'flex', width: 138, height: 138, borderRadius: 36, flexShrink: 0, alignItems: 'center', justifyContent: 'center', background: `hsl(${hue}, 20%, 34%)`, color: 'rgb(255, 250, 244)', fontSize: 52, fontWeight: 700 }}>{initials}</div> : null}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: 16 }}>
          <div style={{ color: 'rgb(199, 174, 146)', fontSize: 23, letterSpacing: 2 }}>{kind}</div>
          <div style={{ fontSize: title.length > 60 ? 48 : 62, fontWeight: 700, lineHeight: 1.12, overflow: 'hidden', maxHeight: 150 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 25, color: 'rgb(211, 201, 193)', overflow: 'hidden', maxHeight: 65 }}>{subtitle}</div> : null}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 25 }}>
        {description ? <div style={{ fontSize: 23, color: 'rgb(199, 192, 188)', overflow: 'hidden', maxHeight: 58 }}>{description}</div> : null}
        <div style={{ display: 'flex', borderTop: '1px solid rgb(102, 91, 87)', paddingTop: 20, justifyContent: 'space-between', color: 'rgb(191, 180, 172)', fontSize: 20 }}><span>INDEPENDENT · STUDENT BUILT</span><span>pccoe.in</span></div>
      </div>
    </div>
  );
}
