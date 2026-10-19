import nextEnv from '@next/env'
nextEnv.loadEnvConfig(process.cwd())
async function run() {
  const base = process.env.SCHEDULER_PUBLIC_URL
  const secret = process.env.CRON_SECRET
  if (!base || !secret) throw new Error('SCHEDULER_PUBLIC_URL and CRON_SECRET are required')
  const url = new URL('/api/scheduler/reconcile', base)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('SCHEDULER_PUBLIC_URL must use HTTPS outside localhost')
  }
  const response = await fetch(url, {
    method: 'POST', headers: {Authorization: `Bearer ${secret}`},
    signal: AbortSignal.timeout(65_000), redirect: 'error',
  })
  if (!response.ok) throw new Error(`Loopin maintenance failed: HTTP ${response.status}`)
  const result = await response.json()
  if (result.ok !== true) throw new Error('Loopin maintenance reported a failure')
  console.log('Loopin maintenance completed')
}
run().catch(error => { console.error(error.message); process.exitCode = 1 })
