import {createHmac} from 'node:crypto'
import * as repo from './repo'

export function webhookSignature(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export async function deliverIntegrationEvents(): Promise<{configured: boolean; delivered: number; failed: number}> {
  const rawUrl = process.env.SCHEDULER_WEBHOOK_URL
  if (!rawUrl) return {configured: false, delivered: 0, failed: 0}
  const secret = process.env.SCHEDULER_WEBHOOK_SECRET
  if (!secret) throw new Error('SCHEDULER_WEBHOOK_SECRET is required when SCHEDULER_WEBHOOK_URL is set')
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('SCHEDULER_WEBHOOK_URL must use HTTPS outside localhost')
  }

  const report = {configured: true, delivered: 0, failed: 0}
  for (const event of await repo.claimIntegrationEvents(10)) {
    const timestamp = String(Math.floor(Date.now() / 1000))
    const body = JSON.stringify({
      id: event.id,
      type: event.eventType,
      occurredAt: event.createdAt.toISOString(),
      data: event.payload,
    })
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Scheduler-Event-Id': event.id,
          'X-Scheduler-Timestamp': timestamp,
          'X-Scheduler-Signature': `sha256=${webhookSignature(secret, timestamp, body)}`,
        },
        body,
        signal: AbortSignal.timeout(4_000),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`)
      await repo.markIntegrationDelivered(event.id)
      report.delivered++
    } catch (err) {
      await repo.markIntegrationFailed(event.id, event.attempts, err instanceof Error ? err.message : 'Unknown delivery error')
      report.failed++
    }
  }
  return report
}
