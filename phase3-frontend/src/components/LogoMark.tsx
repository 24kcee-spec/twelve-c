export function LogoMark({ size = 22 }: { size?: number }) {
  // Four quarter-arcs (10/25/30/35, the actual QPD split) in aged-gold
  // tones - a wax-seal ring rather than a generic logo shape.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="#E9D9AD" strokeWidth="3.6" />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#D4AE5F" strokeWidth="3.6"
        strokeDasharray="5.03 45.24" strokeDashoffset="0"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#BC8F3C" strokeWidth="3.6"
        strokeDasharray="12.57 37.70" strokeDashoffset="-5.03"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#A3741E" strokeWidth="3.6"
        strokeDasharray="15.08 35.19" strokeDashoffset="-17.60"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#7C5714" strokeWidth="3.6"
        strokeDasharray="17.59 32.67" strokeDashoffset="-32.68"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
