import type {Metadata} from 'next'
import SchedulerAdmin from '@/components/scheduler/SchedulerAdmin'

export const metadata: Metadata = {
  title: 'Meeting types | Loopin',
  robots: {index: false, follow: false},
}

export default function SchedulerAdminPage() {
  return <SchedulerAdmin />
}
