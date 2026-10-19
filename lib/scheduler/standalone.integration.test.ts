import {beforeAll, afterAll, describe, expect, it, vi} from 'vitest'
import {execFileSync} from 'node:child_process'
import path from 'node:path'
import {Pool} from 'pg'

vi.mock('./google', () => ({
 freeBusy: vi.fn(async () => []), invalidateFreeBusy: vi.fn(),
 createEvent: vi.fn(async () => ({id:'test-calendar-event', hangoutLink:'https://meet.example.org/test'})),
 meetUrl: vi.fn(() => 'https://meet.example.org/test'), deleteEvent: vi.fn(async () => undefined),
 deleteBookingEvent: vi.fn(async () => undefined), updateEvent: vi.fn(async () => ({})),
}))
vi.mock('./slots', () => ({isOpenSlot: () => true, openSlots: () => []}))
vi.mock('../resend', () => ({sendSchedulerEmail: vi.fn(async () => undefined)}))

const url = process.env.TEST_DATABASE_URL
const suite = url ? describe : describe.skip
suite('standalone Postgres lifecycle (disposable empty database only)', () => {
 let db: Pool
 let repo: typeof import('./repo')
 let service: typeof import('./service')
 let type: import('./types').EventType
 beforeAll(async () => {
  process.env.DATABASE_URL = url
  db = new Pool({connectionString:url})
  const {rows} = await db.query("SELECT to_regclass('scheduler.event_types') AS existing")
  if (rows[0].existing) throw new Error('TEST_DATABASE_URL must refer to an empty disposable database')
  const migrate=()=>execFileSync(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),'db/migrate.ts'],{env:{...process.env,DATABASE_URL:url},stdio:'pipe'})
  migrate(); migrate() // Fresh installation and idempotent rerun.
  repo = await import('./repo'); service = await import('./service')
  const {validateEventTypeAdminCreate} = await import('./admin')
  const parsed=validateEventTypeAdminCreate({slug:'test',title:'Test meeting',durationMin:30,slotStepMin:30,bufferBeforeMin:0,bufferAfterMin:10,minNoticeHours:0,maxDaysAhead:30,maxBookingsPerDay:null,hostTz:'UTC',hours:{mon:[['09:00','17:00']]},questions:[],requireWorkEmail:false,conferenceProvider:'google_meet',active:true})
  if (!parsed.ok) throw new Error(parsed.error)
  type=await repo.createEventTypeForAdmin(parsed.value)
 },30000)
 afterAll(async()=>{ if(repo) await (await import('../db')).pool.end(); if(db) await db.end() })
 const input=(start:string,email='person@example.org')=>({eventType:type,start:new Date(start),fields:{name:'Test Person',email,company:'Example',answers:{}},attendeeTz:'UTC',utm:{utm_source:'embed'},sourcePage:null,ipHash:null,userAgent:null})
 it('books, reschedules and cancels with local contacts and transactional events',async()=>{
  const {booking}=await service.book(input('2035-01-01T10:00:00Z'))
  expect(booking.status).toBe('confirmed'); expect(booking.contactId).toBeTruthy()
  const moved=await service.rescheduleById(booking.id,new Date('2035-01-01T11:00:00Z'))
  expect(moved.rescheduledFrom).toBe(booking.id)
  await service.cancelById(moved.id)
  const {rows}=await db.query('SELECT event_type,payload FROM scheduler.integration_events ORDER BY created_at')
  expect(rows.map(r=>r.event_type)).toEqual(['booking.created','booking.rescheduled','booking.cancelled'])
  expect(rows[0].payload.contactId).toBe(booking.contactId)
  expect((await db.query('SELECT * FROM scheduler.contacts')).rowCount).toBe(1)
  expect((await db.query("SELECT to_regclass('auth.lead_events') AS legacy")).rows[0].legacy).toBeNull()
 })
 it('allows only one concurrent overlapping reservation and enforces its buffer',async()=>{
  const {upsertContact}=await import('../contacts')
  const contact=await upsertContact({email:'race@example.org',name:'Race',company:'Example'})
  const reservation={eventTypeId:type.id,contactId:contact.id,startsAt:new Date('2035-01-02T10:00:00Z'),endsAt:new Date('2035-01-02T10:30:00Z'),attendeeName:'Race',attendeeEmail:'race@example.org',company:'Example',attendeeTz:'UTC',answers:{},utm:{},sourcePage:null,conferenceProvider:'google_meet',manageTokenHash:'race-a',ipHash:null,hostTz:'UTC',maxBookingsPerDay:null,bufferBeforeMin:0,bufferAfterMin:10}
  const results=await Promise.allSettled([repo.insertPendingBooking(reservation),repo.insertPendingBooking({...reservation,manageTokenHash:'race-b'})])
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1)
  await expect(repo.insertPendingBooking({...reservation,manageTokenHash:'buffer',startsAt:new Date('2035-01-02T10:30:00Z'),endsAt:new Date('2035-01-02T11:00:00Z')})).rejects.toMatchObject({code:'SL_BUFFER_CONFLICT'})
 })
 it('cleans a failed calendar creation without depending on CMS tables',async()=>{
  const google=await import('./google')
  vi.mocked(google.createEvent).mockRejectedValueOnce(new Error('provider unavailable'))
  await expect(service.book(input('2035-01-03T10:00:00Z','failure@example.org'))).rejects.toMatchObject({code:'unavailable'})
  expect((await db.query("SELECT 1 FROM scheduler.bookings WHERE attendee_email='failure@example.org'")).rowCount).toBe(0)
 })
})
