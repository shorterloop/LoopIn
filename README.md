# Loopin

Loopin is a self-hosted, single-host scheduler with Google Calendar, Google Meet/Zoom, public booking pages, an admin dashboard and iframe embeds.  PostgreSQL owns contacts, meeting types, bookings, availability overrides, calendar credentials and a transactional webhook outbox.

## Local setup

Requires Node 22.12+ and PostgreSQL 16+.

1. `npm ci`
2. Copy `.env.example` to `.env.local`. Set `DATABASE_URL` and `SCHEDULER_PUBLIC_URL`.
3. Generate independent values for `SCHEDULER_ADMIN_TOKEN`, `SCHEDULER_TOKEN_KEY`, and `CRON_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. The encryption key must be 64 hex characters. Preserve it across deployments.
4. `npm run db:migrate` (loads `.env.local` automatically).
5. `npm run dev -- --port 3008`
6. Open `/scheduler/admin`, enter the admin token, connect Google, create a meeting type, set the host timezone and availability, then activate it. No marketing-specific meeting types are seeded.
7. Share `/scheduler/<slug>` or embed `/embed/<slug>`.

For Docker: create `.env.local`, then `docker compose --env-file .env.local up --build`. Postgres data is persisted in the `scheduler-db` volume. The sample Postgres credentials are for local development. The image runs migrations before starting the app; it builds without database access.

## Google Calendar

Enable the Google Calendar API and create a Web application OAuth client. Register `<SCHEDULER_PUBLIC_URL>/api/scheduler/admin/google/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SCHEDULER_TOKEN_KEY`. Configure your OAuth consent audience/test users, then connect the intended host account from admin. The app requests calendar.events and calendar.freebusy with offline access. A `GOOGLE_REFRESH_TOKEN` environment value is an alternative and takes precedence over the database connection.

Google sends attendee invitations. Optional host email uses `RESEND_API_KEY`, `RESEND_FROM`, and `SCHEDULER_HOST_EMAIL`. Zoom requires all four `ZOOM_*` variables. Enable Turnstile with both keys in `.env.example`; the public key is a build-time setting.

## Admin and configuration

- `/scheduler/admin`: meeting types, weekly hours, date overrides, questions, calendar connection.
- `/scheduler/admin/bookings`: bookings, answers, cancellation, rescheduling, webhook retry.
- `/scheduler/admin/configuration`: configuration indicators, embed URL and iframe HTML.

Admin API calls require `Authorization: Bearer <SCHEDULER_ADMIN_TOKEN>`. This release uses one operator token, stored in browser session storage; it does not provide accounts, roles, multi-host teams or round robin. Deployment credentials stay in environment variables, not browser configuration forms. Configuration indicators report presence, not provider health.

## Embedding in Sanity or another site

Set `SCHEDULER_EMBED_ORIGINS` to comma-separated exact parent origins, e.g. `https://shorterloop.com,https://your-studio.sanity.studio`, and rebuild. Only `/embed/*` allows framing; admin and manage pages cannot be framed.

```html
<iframe src="https://booking.example.com/embed/demo"
  title="Book a meeting" width="100%" height="850"
  style="border:0" loading="lazy"></iframe>
```

Sanity only stores the public embed URL. It receives no admin secrets and does not need direct database access. In the existing Shorter Loop page builder, paste the URL into the Scheduler slot's **Standalone scheduler embed URL** field. That field switches the slot to the remote app; existing local event-type slots continue to work. The slot's old after-booking redirect is not applied to the remote embed. If your page is inside a Studio preview iframe, allow every ancestor origin. The embed has a fixed viewport height and may scroll on small screens. Append UTMs to its URL for attribution; parent-page UTMs are not copied automatically.

## Deployment

Loopin runs as a Node.js app or Docker container with PostgreSQL. The app and database can be hosted by different providers; Railway is optional. See [DEPLOYMENT.md](DEPLOYMENT.md) for Node.js, Docker, Docker Compose, scheduled maintenance and Railway instructions.

The deployment contract is:

- Node.js 22.12+ (or the included Docker image).
- A reachable PostgreSQL 16+ database through `DATABASE_URL`.
- Runtime secrets from `.env.example` and a public HTTPS origin in `SCHEDULER_PUBLIC_URL`.
- Build-time `SCHEDULER_EMBED_ORIGINS` and optional `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- A scheduled `npm run reconcile` job or authenticated HTTP call to `/api/scheduler/reconcile`.

Use a fresh database when extracting from the CMS. Migrations create only the `scheduler` schema and its own ledger, and refuse a legacy CMS scheduler schema. Moving existing bookings requires a reviewed export/import. The database can remain on Railway even if you deploy Loopin elsewhere, provided the app has network access to it.

## Customer integration

Set `SCHEDULER_WEBHOOK_URL` and `SCHEDULER_WEBHOOK_SECRET`. Booking creation, cancellation and rescheduling write durable lifecycle events in the same transaction as the booking change. Deliveries retry with backoff through reconcile or the admin retry action. Payloads use scheduler-local `contactId` values, not external customer IDs.

The body is `{id,type,occurredAt,data}`. Deduplicate on `X-Scheduler-Event-Id`. Verify `X-Scheduler-Signature` (`sha256=` plus HMAC-SHA256 over `<X-Scheduler-Timestamp>.<raw body>`) and reject stale timestamps. Payloads contain personal data; choose a trusted receiver. Configure the deployed webhook before relying on delivery. No customer-system receiver is deployed by this repository.

## Validation and release

`npm test`, `npm run typecheck`, and `npm run build`. Optional database integration tests use `TEST_DATABASE_URL` pointing to a disposable, empty database, never your customer database. They exercise actual SQL and transactions with Google responses mocked. CI runs them against PostgreSQL 16. Before release, exercise real Google/Zoom booking, cancel/reschedule, concurrent reservations, failed provider calls, cron delivery and mobile embeds. Configure your own privacy policy/retention process; the generic privacy page is a starting point.

License selection is pending owner confirmation. Do not publish as open source until a license is added. Publish this directory only, after reviewing its contents; the surrounding workspace is not the scheduler distribution.
