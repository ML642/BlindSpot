export function LogoMark({ size = 30 }: { size?: number }) {
  return <svg className="logo-mark" width={Math.round(size * 1.4)} height={size} viewBox="0 0 48 32" fill="none" aria-hidden="true">
    <path className="logo-orbit" d="M3.5 16C11.7 5.2 28.8 3 40.8 10.6L44 13" />
    <path className="logo-orbit" d="M44 19C35.1 28.8 17.2 29.9 6.9 20.3L3.5 16" />
    <circle className="logo-focus" cx="23.5" cy="16" r="5" />
    <circle className="logo-spark" cx="44" cy="16" r="2" />
  </svg>;
}
