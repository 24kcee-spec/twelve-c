export function LogoMark({ size = 22 }: { size?: number }) {
  // Four quarter-arcs (10/25/30/35, the actual QPD split) in forest-green
  // tones - a wax-seal ring rather than a generic logo shape.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="#C9DDC2" strokeWidth="3.6" />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#9EC494" strokeWidth="3.6"
        strokeDasharray="5.03 45.24" strokeDashoffset="0"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#6B9A63" strokeWidth="3.6"
        strokeDasharray="12.57 37.70" strokeDashoffset="-5.03"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#355A3B" strokeWidth="3.6"
        strokeDasharray="15.08 35.19" strokeDashoffset="-17.60"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#1F3B24" strokeWidth="3.6"
        strokeDasharray="17.59 32.67" strokeDashoffset="-32.68"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
