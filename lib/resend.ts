function getApiKey() { return process.env.RESEND_API_KEY || '' }
function getFromAddress() { return process.env.RESEND_FROM || '' }
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]!))
}
export interface SchedulerEmailParams {
  kind: 'booked' | 'cancelled' | 'rescheduled'
  eventTitle: string
  name: string
  email: string
  company: string
  /** Human-readable time, already formatted in the host's zone. */
  when: string
  /** For a reschedule: the time it moved from. */
  previousWhen?: string
  joinUrl?: string | null
  answers: Array<{question: string; answer: string}>
  utm: Record<string, string>
  sourcePage?: string | null
}

/**
 * Tell the host about a booking, cancellation or reschedule. The visitor's
 * emails come from Google Calendar; this is the team's copy, with the answers
 * and attribution the calendar event doesn't carry. Destination is
 * SCHEDULER_HOST_EMAIL, then CONTACT_TO.
 */
export async function sendSchedulerEmail(params: SchedulerEmailParams): Promise<void> {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM || !process.env.SCHEDULER_HOST_EMAIL) return
  const to = process.env.SCHEDULER_HOST_EMAIL || getFromAddress()
  const verb = {booked: 'New booking', cancelled: 'Cancelled', rescheduled: 'Rescheduled'}[params.kind]

  const row = (label: string, value: string) =>
    `<p style="margin: 4px 0;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`
  const answersHtml = params.answers
    .map(
      ({question, answer}) => `
      <p style="margin: 20px 0 4px; font-weight: 600;">${escapeHtml(question)}</p>
      <p style="white-space: pre-wrap; background: #f6f6f4; padding: 12px 16px; border-radius: 8px; margin: 0;">${escapeHtml(answer)}</p>`,
    )
    .join('')
  const utmEntries = Object.entries(params.utm)

  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a18;">
      <h2 style="color: #c4501c; margin-bottom: 16px;">${escapeHtml(verb)}: ${escapeHtml(params.eventTitle)}</h2>
      ${row('When', params.when)}
      ${params.previousWhen ? row('Was', params.previousWhen) : ''}
      ${row('Name', params.name)}
      <p style="margin: 4px 0;"><strong>Email:</strong> <a href="mailto:${escapeHtml(params.email)}">${escapeHtml(params.email)}</a></p>
      ${row('Company', params.company)}
      ${params.joinUrl ? `<p style="margin: 4px 0;"><strong>Join:</strong> <a href="${escapeHtml(params.joinUrl)}">${escapeHtml(params.joinUrl)}</a></p>` : ''}
      ${answersHtml}
      ${utmEntries.length ? `<p style="font-size: 13px; color: #999; margin-top: 24px;">${utmEntries.map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(v)}`).join(' · ')}</p>` : ''}
      ${params.sourcePage ? `<p style="font-size: 13px; color: #999; margin-top: 8px;">Booked from ${escapeHtml(params.sourcePage)}</p>` : ''}
    </div>
  `

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: getFromAddress(),
      to,
      subject: `${verb} — ${params.company} : ${params.eventTitle} — ${params.when}`,
      html,
      reply_to: params.email,
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error(`[Resend] scheduler email ${response.status}:`, errorBody)
    throw new Error(`Resend: scheduler email failed: ${response.status}`)
  }
}
