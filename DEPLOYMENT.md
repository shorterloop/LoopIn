# Deploying Loopin

Loopin supports two runtime targets: a Node.js server and a Linux Docker container. Both use ordinary PostgreSQL and HTTP APIs. There is no required hosting-provider SDK, filesystem upload storage or Railway runtime dependency. This app needs a server runtime; it cannot be deployed as a static site.

## Shared configuration

Set the variables in [.env.example](.env.example) through your host's secret store (or `.env.local` for a manually managed Node deployment). Set `SCHEDULER_PUBLIC_URL` to the public HTTPS origin and register `<origin>/api/scheduler/admin/google/callback` in Google OAuth. Preserve `SCHEDULER_TOKEN_KEY` when moving hosts so existing encrypted calendar credentials remain readable.

Set `SCHEDULER_EMBED_ORIGINS` before building; its allowlist is compiled into response headers. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` before building if using Turnstile. All other credentials are runtime values. A database connection is not needed during the build.

The app host and database provider can differ. Use a connection URL reachable from the app's network. A Railway private database hostname works only inside the corresponding private network; an app hosted elsewhere needs an externally reachable connection URL. Use the database provider's TLS configuration in `DATABASE_URL`; Loopin does not disable certificate verification.

Use a new database for a fresh installation. Database migrations are explicit for Node deployments and run on container startup by default. Back up existing data before upgrades. Migrations refuse a legacy CMS scheduler schema.

## Node.js server

Use this directory as the application root. Install Node.js 22.12+ and configure PostgreSQL 16+.

```sh
npm ci
npm run build
npm run db:migrate
npm start
```

For managed hosting, configure `npm ci && npm run build` as the build command, `npm run db:migrate` as a release/pre-deploy command, and `npm start` as the start command. If the host has no release command, run migrations once before starting a new release. Keep the full install for building and migrations: `tsx` is a runtime dependency and TypeScript is a build dependency.

`npm start` binds to `0.0.0.0` and uses `PORT`, defaulting to 3000. Put a public HTTPS reverse proxy in front of it, or use your host's managed HTTPS ingress. A VPS can run the process under systemd or another process supervisor. For a simple HTTP availability probe use `/`; it does not validate calendar or database connectivity.

## Docker container

Build from this directory. Supply public build settings explicitly:

```sh
docker build -t loopin:local \
  --build-arg SCHEDULER_EMBED_ORIGINS=https://www.example.com \
  .
docker run --env-file .env.local -e PORT=3000 -p 3008:3000 loopin:local
```

Provide a `DATABASE_URL` reachable from the container; `localhost` refers to the container itself. The image listens on `PORT` (3000 by default), runs as a non-root user, and forwards termination signals to Node. Set runtime secrets on the container platform rather than baking them into the image. No application volume is needed; PostgreSQL requires persistent storage.

By default the container applies migrations before starting. If your platform runs a separate release task, run `./node_modules/.bin/tsx db/migrate.ts` in the built image and set `RUN_MIGRATIONS=false` on the web container. Migrations use a database lock so concurrent starts serialize the migration work.

Docker-compatible hosting can use this same Dockerfile, environment variables, port and startup command. Configure HTTPS, a reachable database and a scheduled maintenance job using that host's controls. Host-specific deployment manifests are optional; only Railway currently has a bundled one.

## Docker Compose

The included Compose file provides a local app and PostgreSQL:

```sh
docker compose --env-file .env.local up --build
```

Open `http://localhost:3008`. The Compose file overrides `DATABASE_URL` to the bundled database and persists data in `scheduler-db`. Its sample database password and exposed database port are intended for development. For a server deployment, configure production database credentials/network access and HTTPS ingress explicitly.

## Scheduled maintenance on any host

Schedule this command from the Loopin directory with `SCHEDULER_PUBLIC_URL` and `CRON_SECRET` available:

```sh
npm run reconcile
```

It calls the protected maintenance endpoint, exits unsuccessfully on a failed response, and does not print the token or attendee payloads. It can run from a scheduled container, a host cron job, or a task runner; the web app must already be running. The equivalent HTTP request is `POST /api/scheduler/reconcile` with `Authorization: Bearer <CRON_SECRET>`.

Run daily for calendar reconciliation or more frequently when you need timely webhook delivery. Each call sends up to ten due integration events and also performs calendar recovery. Inspect failed job exits and use the admin booking screen to retry failed syncs. There is no built-in timer tied to a particular host.

## Railway (optional)

Use `LoopIn` as the service root while this app lives in the workspace, and `/LoopIn/railway.json` as the config-file path. In a standalone repository use its root and `/railway.json`. The Dockerfile handles build/startup. Set secrets, the public origin, and the two public build arguments as service variables. Reference a reachable Postgres connection URL. Configure a scheduled job to run `npm run reconcile`.

Railway database hosting is independent of Railway app hosting. You may keep your database there and move the app, or move both while preserving the database contents and encryption key.

## Moving between hosts

1. Back up the database and preserve server secrets, especially `SCHEDULER_TOKEN_KEY`.
2. Restore or connect the database from the new app host; never point a fresh install at an incompatible CMS scheduler schema.
3. Configure build settings and runtime variables, build, migrate, then start.
4. Update DNS/HTTPS and the Google redirect URI if the public origin changes.
5. Update embeds and the maintenance job's destination if needed.
6. Validate booking, invitation, reschedule, cancellation and webhook delivery before directing visitors to the new service.

The Node build and automated tests can be checked locally with `npm run build`, `npm run typecheck`, and `npm test`. Container and cloud deployments still need validation on the target host.

References: [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting), [Railway private networking](https://docs.railway.com/networking/private-networking).
