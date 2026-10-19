import {loadEnvConfig} from '@next/env'
import {Pool} from 'pg'
import {readFile, readdir} from 'node:fs/promises'
import path from 'node:path'
loadEnvConfig(process.cwd())
async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')
  const pool = new Pool({connectionString: process.env.DATABASE_URL})
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('standalone-scheduler-migrations'))")
    const {rows} = await client.query("SELECT to_regclass('scheduler.event_types') AS existing, to_regclass('scheduler.app_migrations') AS ledger")
    if (rows[0].existing && !rows[0].ledger) throw new Error('Existing scheduler schema detected. Use a fresh database; CMS migrations cannot be reused.')
    await client.query('CREATE SCHEMA IF NOT EXISTS scheduler')
    await client.query('CREATE TABLE IF NOT EXISTS scheduler.app_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
    const dir = path.join(process.cwd(), 'db/migrations')
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
      const applied = await client.query('SELECT 1 FROM scheduler.app_migrations WHERE name = $1', [file])
      if (applied.rowCount) continue
      await client.query(await readFile(path.join(dir, file), 'utf8'))
      await client.query('INSERT INTO scheduler.app_migrations(name) VALUES ($1)', [file])
      console.log('Applied', file)
    }
    await client.query('COMMIT')
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release(); await pool.end() }
}
migrate().catch(error => { console.error(error); process.exitCode = 1 })
