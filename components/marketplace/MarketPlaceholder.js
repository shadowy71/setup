/** An honest visual fallback, never a stock image of an unpictured item. */
export function MarketPlaceholder({ label = 'No photo provided' }) {
  return (
    <div className="market-placeholder" role="img" aria-label={label}>
      <svg className="market-placeholder__art" viewBox="0 0 120 94" fill="none" aria-hidden="true">
        <circle cx="60" cy="46" r="41" fill="currentColor" opacity=".09" />
        <path d="M35 38 60 27l25 11v24L60 74 35 62V38Z" fill="currentColor" opacity=".14" />
        <path d="M35 38 60 27l25 11v24L60 74 35 62V38ZM35 38l25 12 25-12M60 50v24M47 32l25 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M24 25v8m-4-4h8m70 29v8m-4-4h8M91 22h.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
