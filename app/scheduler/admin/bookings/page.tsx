import type {Metadata} from 'next'
import SchedulerBookings from '@/components/scheduler/SchedulerBookings'

export const metadata: Metadata = {title: 'Bookings | Loopin', robots: {index: false, follow: false}}

export default function SchedulerBookingsPage() {
  return <SchedulerBookings />
}
