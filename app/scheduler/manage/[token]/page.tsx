import type {Metadata} from 'next'
import ManageBooking, {type ManageSummary} from '@/components/scheduler/ManageBooking'
import {bookingForToken, SchedulerError} from '@/lib/scheduler/service'
import {isWellFormedToken} from '@/lib/scheduler/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// A private page behind a secret link: never indexed, never sends its URL on.
export const metadata: Metadata = {
  title: 'Manage your meeting | Loopin',
  robots: {index: false, follow: false},
  referrer: 'no-referrer',
}

function Shell({children}: {children: React.ReactNode}) {
  return (
    <section className="section">
      <div className="container container--narrow">{children}</div>
    </section>
  )
}

export default async function ManageBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{token: string}>
  searchParams: Promise<{action?: string}>
}) {
  const {token} = await params
  const {action} = await searchParams

  let summary: ManageSummary | null = null
  let problem = 'This link is not valid. Use the links in your most recent calendar invite.'

  if (isWellFormedToken(token)) {
    try {
      const {booking, eventType} = await bookingForToken(token)
      summary = {
        title: eventType.title,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        status: booking.status,
        joinUrl: booking.joinUrl,
        conferenceProvider: booking.conferenceProvider,
        maxDaysAhead: eventType.maxDaysAhead,
        started: booking.startsAt.getTime() <= Date.now(),
      }
    } catch (err) {
      if (!(err instanceof SchedulerError)) {
        console.error('[scheduler] manage page lookup failed:', err)
        problem = 'We couldn’t load your meeting right now. Please try again shortly.'
      }
    }
  }

  return (
    <Shell>
      {summary ? (
        <ManageBooking
          token={token}
          summary={summary}
          initialAction={action === 'cancel' || action === 'reschedule' ? action : undefined}
        />
      ) : (
        <header className="section-header">
          <p className="eyebrow">Manage your meeting</p>
          <h1 className="headline-md">Link not found</h1>
          <p className="lead">{problem}</p>
        </header>
      )}
    </Shell>
  )
}
