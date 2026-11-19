#!/usr/bin/env bash
# Crea desde cero una persistencia local AISLADA de pruebas del CMS (esquema + borradores + usuarios sintéticos).
#   scripts/cms-provision.sh fase-03-cms 4440      (requiere `npm run build` previo con EMDASH_SITE_URL=http://localhost:<puerto>)
# Después, con el mismo EMDASH_SITE_URL exportado, arrancar el Worker con el aprobador sintético como --var (el build copia .env a
# dist/server/.dev.vars y Wrangler ignora entonces --env-file):
#   node scripts/local-worker.mjs --persist-to .wrangler/fase-03-cms --var "DP_SYNTHETIC_PUBLISHERS:$(sed -n 's/^DP_SYNTHETIC_PUBLISHERS=//p' .wrangler/fase-03-cms/fixture.env)"
set -euo pipefail
NAME=${1:?nombre fase-*}; PORT=${2:-4440}
[[ "$NAME" =~ ^fase-[a-z0-9-]+$ ]] || { echo "El nombre debe ser fase-<algo>"; exit 2; }
DIR=".wrangler/$NAME"; export EMDASH_SITE_URL="http://localhost:$PORT"
rm -rf "$DIR"
npx wrangler d1 migrations apply DB --local --persist-to "$DIR" >/dev/null
# Primer arranque: el runtime aplica sus migraciones y el esquema del seed. Se detiene solo nuestro grupo de procesos.
setsid node scripts/local-worker.mjs --persist-to "$DIR" > "/tmp/provision-$NAME.log" 2>&1 & PGID=$!
for _ in $(seq 1 60); do curl -fs -o /dev/null "$EMDASH_SITE_URL/contacto/" && break || sleep 1; done
kill -- -"$PGID" 2>/dev/null || true; sleep 2
npx tsx scripts/cms-migrate.ts --persist-to "$DIR" 2>&1 | grep -E '"(created|skipped)"' | tr -d '\n'; echo
rm -rf "$DIR"/{cache,d1,r2}
npx tsx scripts/cms-fixture.ts --persist-to "$DIR" 2>&1 | grep Usuarios
rm -rf "$DIR"/{cache,d1,r2}
