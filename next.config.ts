import type {NextConfig} from 'next'
import path from 'node:path'
const allowed = (process.env.SCHEDULER_EMBED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).map(raw => {
  const url = new URL(raw)
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== raw) throw new Error('SCHEDULER_EMBED_ORIGINS must contain comma-separated exact HTTP(S) origins')
  return url.origin
})
const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  turbopack: {root: path.resolve(process.cwd())},
  async headers() { return [
    {source:'/:path*', headers:[{key:'Content-Security-Policy',value:"frame-ancestors 'none'"},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Content-Type-Options',value:'nosniff'}]},
    {source:'/embed/:path*',headers:[{key:'Content-Security-Policy',value:`frame-ancestors 'self' ${allowed.join(' ')}`.trim()}]},
  ] },
}
export default config
