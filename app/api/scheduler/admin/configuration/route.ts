import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
export const dynamic = 'force-dynamic'
export async function GET(request: NextRequest) {
 if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok:false},{status:401})
 const configured = (names:string[]) => names.every(name => Boolean(process.env[name]))
 return NextResponse.json({ok:true, publicUrl:process.env.SCHEDULER_PUBLIC_URL || '', embedOrigins:process.env.SCHEDULER_EMBED_ORIGINS || '', checks:{
  database:configured(['DATABASE_URL']), googleOAuth:configured(['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']),
  encryption:/^[0-9a-f]{64}$/i.test(process.env.SCHEDULER_TOKEN_KEY || ''), cron:configured(['CRON_SECRET']),
  hostEmail:configured(['RESEND_API_KEY','RESEND_FROM','SCHEDULER_HOST_EMAIL']),
  zoom:configured(['ZOOM_ACCOUNT_ID','ZOOM_CLIENT_ID','ZOOM_CLIENT_SECRET','ZOOM_HOST_EMAIL']),
  turnstile:configured(['NEXT_PUBLIC_TURNSTILE_SITE_KEY','TURNSTILE_SECRET_KEY']),
  webhook:configured(['SCHEDULER_WEBHOOK_URL','SCHEDULER_WEBHOOK_SECRET']),
 }},{headers:{'Cache-Control':'no-store'}})
}
