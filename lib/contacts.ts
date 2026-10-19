import {pool, withDbRetry} from './db'
export async function upsertContact(input: {email: string; name: string; company: string; role?: string}) {
  const {rows} = await withDbRetry(() => pool.query<{id: string}>(`
    INSERT INTO scheduler.contacts (email, name, company, role) VALUES (lower($1), $2, $3, $4)
    ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company,
      role = COALESCE(EXCLUDED.role, scheduler.contacts.role), updated_at = NOW()
    RETURNING id`, [input.email, input.name, input.company, input.role ?? null]))
  return rows[0]
}
