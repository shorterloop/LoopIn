import type {Metadata} from 'next'
import {notFound} from 'next/navigation'
import Scheduler from '@/components/scheduler/Scheduler'
import {getEventTypeBySlug} from '@/lib/scheduler/repo'
import styles from './page.module.css'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{slug: string}>
}

export async function generateMetadata({params}: Props): Promise<Metadata> {
  const {slug} = await params
  const eventType = await getEventTypeBySlug(slug)
  return {
    title: eventType ? `Book ${eventType.title} | Loopin` : 'Meeting not found | Loopin',
    description: eventType?.description ?? undefined,
    robots: {index: false, follow: false},
  }
}

export default async function BookingPage({params}: Props) {
  const {slug} = await params
  const eventType = await getEventTypeBySlug(slug)
  if (!eventType) notFound()

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <a className={styles.brand} href="/">Loopin</a>
        </header>
        <div className={styles.content}>
          <p className={styles.eyebrow}>Book a meeting</p>
          <h1 className={styles.title}>{eventType.title}</h1>
          <Scheduler eventType={slug} />
        </div>
      </div>
    </main>
  )
}
