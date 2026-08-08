export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="#CFE3D8" strokeWidth="3.6" />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#5FA588" strokeWidth="3.6"
        strokeDasharray="5.03 45.24" strokeDashoffset="0"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#357E64" strokeWidth="3.6"
        strokeDasharray="12.57 37.70" strokeDashoffset="-5.03"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#1F6F54" strokeWidth="3.6"
        strokeDasharray="15.08 35.19" strokeDashoffset="-17.60"
        transform="rotate(-90 12 12)"
      />
      <circle
        cx="12" cy="12" r="8" fill="none" stroke="#12503D" strokeWidth="3.6"
        strokeDasharray="17.59 32.67" strokeDashoffset="-32.68"
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
