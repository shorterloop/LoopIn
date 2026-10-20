import type {Metadata} from 'next'
import PublicFrame from '@/components/PublicFrame'

export const metadata: Metadata = {title: 'Booking privacy | Loopin'}

export default function Privacy() {
  return (
    <PublicFrame narrow>
      <article className="card section-header">
        <p className="eyebrow">Privacy</p>
        <h1 className="headline-md">Booking privacy</h1>
        <p className="lead">
          This scheduler stores your contact details, answers, selected time and campaign attribution. Your details are
          shared with the host and the configured calendar and conferencing providers to arrange your meeting. Contact
          the meeting host for their privacy policy, retention period and data requests.
        </p>
      </article>
    </PublicFrame>
  )
}
