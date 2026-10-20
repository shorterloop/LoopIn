/** Loopin wordmark: two linked rings and the name. */
export function LogoMark({size = 22}: {size?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="12" r="6" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="15" cy="12" r="6" stroke="currentColor" strokeWidth="2.5" opacity="0.55" />
    </svg>
  )
}

export default function Logo({href = '/'}: {href?: string}) {
  return (
    <a className="brand" href={href}>
      <LogoMark />
      Loopin
    </a>
  )
}
