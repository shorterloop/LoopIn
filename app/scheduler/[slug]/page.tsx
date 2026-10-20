import type {Metadata} from 'next'
import {notFound} from 'next/navigation'
import PublicFrame from '@/components/PublicFrame'
import Scheduler from '@/components/scheduler/Scheduler'
import {getEventTypeBySlug} from '@/lib/scheduler/repo'

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
    <PublicFrame>
      <Scheduler eventType={slug} />
    </PublicFrame>
  )
}
