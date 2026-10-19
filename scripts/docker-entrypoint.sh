#!/bin/sh
set -eu
if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  ./node_modules/.bin/tsx db/migrate.ts
fi
exec node server.js
