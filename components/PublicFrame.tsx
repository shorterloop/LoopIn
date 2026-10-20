import type {ReactNode} from 'react'
import {LogoMark} from './Logo'

/** Page frame for attendee-facing pages: centred content and a quiet footer. */
export default function PublicFrame({children, narrow = false}: {children: ReactNode; narrow?: boolean}) {
  return (
    <div className="site">
      <main className="site__main" style={narrow ? {maxWidth: 720} : undefined}>
        {children}
      </main>
      <footer className="site__footer">
        <a className="brand" href="https://github.com/shorterloop/LoopIn" style={{fontSize: 13, fontWeight: 600, color: 'inherit'}}>
          <LogoMark size={16} />
          Powered by Loopin
        </a>
        {' · '}
        <a href="/privacy-policy">Privacy</a>
      </footer>
    </div>
  )
}
