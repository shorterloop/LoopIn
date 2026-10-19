import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {NextRequest} from 'next/server'
vi.mock('./connection', () => ({connectionMode: vi.fn(async () => 'none')}))
import {POST} from '@/app/api/scheduler/admin/google/connect/route'
beforeEach(()=>{
 vi.stubEnv('SCHEDULER_ADMIN_TOKEN','test-admin')
 vi.stubEnv('GOOGLE_CLIENT_ID','test-client')
 vi.stubEnv('GOOGLE_CLIENT_SECRET','test-secret')
 vi.stubEnv('SCHEDULER_TOKEN_KEY','ab'.repeat(32))
 vi.stubEnv('SCHEDULER_PUBLIC_URL','https://loopin.example.org')
})
afterEach(()=>vi.unstubAllEnvs())
const request=()=>new NextRequest('https://loopin.example.org/api/scheduler/admin/google/connect',{method:'POST',headers:{Authorization:'Bearer test-admin'}})
it('names missing OAuth configuration without disclosing credentials',async()=>{
 vi.stubEnv('GOOGLE_CLIENT_ID','')
 const response=await POST(request())
 expect(response.status).toBe(503)
 const json=await response.json()
 expect(json.error).toContain('GOOGLE_CLIENT_ID')
 expect(json.error).not.toContain('test-secret')
})
it('explains invalid encryption keys',async()=>{
 vi.stubEnv('SCHEDULER_TOKEN_KEY','invalid')
 const response=await POST(request())
 expect(response.status).toBe(503)
 expect((await response.json()).error).toContain('64-character hexadecimal')
})
it('returns the configured callback and a secure state cookie',async()=>{
 const response=await POST(request())
 expect(response.status).toBe(200)
 const url=new URL((await response.json()).url)
 expect(url.origin).toBe('https://accounts.google.com')
 expect(url.searchParams.get('redirect_uri')).toBe('https://loopin.example.org/api/scheduler/admin/google/callback')
 expect(response.cookies.get('sl_scheduler_oauth')?.value).toBe(url.searchParams.get('state'))
 expect(response.headers.get('set-cookie')).toContain('Secure')
})
