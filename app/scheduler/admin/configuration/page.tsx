'use client'
import {useEffect,useState} from 'react'
interface Configuration {publicUrl:string;embedOrigins:string;checks:Record<string,boolean>}
export default function ConfigurationPage() {
 const [token,setToken]=useState(''), [config,setConfig]=useState<Configuration|null>(null)
 const [types,setTypes]=useState<Array<{slug:string;title:string}>>([]), [slug,setSlug]=useState(''), [error,setError]=useState('')
 useEffect(()=>setToken(sessionStorage.getItem('scheduler-admin-token') || ''),[])
 async function load() {
  setError(''); setConfig(null); setTypes([])
  try {
   const headers={Authorization:`Bearer ${token.trim()}`}
   const [a,b]=await Promise.all([fetch('/api/scheduler/admin/configuration',{headers}),fetch('/api/scheduler/admin/event-types',{headers})])
   if (!a.ok || !b.ok) throw new Error('Unable to load configuration. Check the admin token and database.')
   const c=await a.json(), t=await b.json()
   sessionStorage.setItem('scheduler-admin-token',token.trim());setConfig(c);setTypes(t.eventTypes);setSlug(t.eventTypes[0]?.slug || '')
  } catch(e) {setError(e instanceof Error ? e.message : 'Could not load configuration')}
 }
 const embed=config && slug ? `${config.publicUrl.replace(/\/+$/,'')}/embed/${encodeURIComponent(slug)}` : ''
 const htmlEscape=(s:string)=>s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 return <main className="container"><nav><a href="/scheduler/admin">Event types & calendar</a><a href="/scheduler/admin/bookings">Bookings</a></nav><h1>Configuration & embeds</h1>
 <p>Set server secrets in your hosting environment. This page shows configuration status without revealing credentials.</p>
 <label>Admin token <input type="password" value={token} onChange={e=>setToken(e.target.value)} autoComplete="current-password"/></label> <button className="btn btn--primary" onClick={load}>Load configuration</button>
 {error && <p role="alert">{error}</p>}
 {config && <><h2>Service configuration</h2><p>Public URL: <code>{config.publicUrl || 'SCHEDULER_PUBLIC_URL is missing'}</code></p><ul>{Object.entries(config.checks).map(([key,value])=><li key={key}>{key}: {value ? 'Configured' : 'Not configured'}</li>)}</ul>
 <p>Google OAuth, database, encryption and cron are required for normal operation. Host email, Zoom, Turnstile and webhooks are optional. These indicators check settings, not live service connectivity.</p>
 <h2>Embed a booking page</h2><p>Allowed parent origins: <code>{config.embedOrigins || 'Only this app'}</code>. Change SCHEDULER_EMBED_ORIGINS and rebuild to allow your website and Sanity preview origins.</p>
 <label>Meeting type <select value={slug} onChange={e=>setSlug(e.target.value)}>{types.map(t=><option key={t.slug} value={t.slug}>{t.title}</option>)}</select></label>
 {embed && <><p>Embed URL: <a href={embed}>{embed}</a></p><label>Iframe HTML<textarea aria-label="Iframe HTML" readOnly rows={5} style={{width:'100%'}} value={`<iframe src="${htmlEscape(embed)}" title="Book a meeting" width="100%" height="850" style="border:0" loading="lazy"></iframe>`}/></label><p>Use an active meeting type. For Sanity, paste this URL into an iframe/embed slot. Add UTM parameters to the embed URL if you need campaign attribution.</p></>}
 </>}
 </main>
}
