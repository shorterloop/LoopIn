import Link from 'next/link'
import {FiCalendar, FiCode, FiInbox} from 'react-icons/fi'
import PublicFrame from '@/components/PublicFrame'
import {LogoMark} from '@/components/Logo'
import styles from './page.module.css'

const LINKS = [
  {href: '/scheduler/admin', icon: FiCalendar, title: 'Meeting types', text: 'Set durations, weekly hours and booking questions, and connect your calendar.'},
  {href: '/scheduler/admin/bookings', icon: FiInbox, title: 'Bookings', text: 'See upcoming meetings, read answers, reschedule or cancel.'},
  {href: '/scheduler/admin/configuration', icon: FiCode, title: 'Share & embed', text: 'Copy booking links and iframe code, and check server settings.'},
]

export default function Home() {
  return (
    <PublicFrame narrow>
      <div className={styles.hero}>
        <span className={styles.mark}><LogoMark size={36} /></span>
        <h1>Loopin</h1>
        <p className="lead">Self-hosted scheduling. Configure meeting types, connect your calendar and share booking links.</p>
      </div>
      <nav className={styles.links} aria-label="Admin">
        {LINKS.map(({href, icon: Icon, title, text}) => (
          <Link key={href} href={href} className={styles.link}>
            <span className={styles.icon} aria-hidden="true"><Icon /></span>
            <span>
              <strong>{title}</strong>
              <span>{text}</span>
            </span>
          </Link>
        ))}
      </nav>
    </PublicFrame>
  )
}
