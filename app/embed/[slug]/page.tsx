import {notFound} from 'next/navigation'
import Scheduler from '@/components/scheduler/Scheduler'
import {getEventTypeBySlug} from '@/lib/scheduler/repo'
export const dynamic = 'force-dynamic'
export default async function EmbedPage({params}: {params:Promise<{slug:string}>}) {
 const {slug} = await params
 const type = await getEventTypeBySlug(slug)
 if (!type) notFound()
 return <main className="embed-page"><h1>{type.title}</h1><Scheduler eventType={slug}/></main>
}
