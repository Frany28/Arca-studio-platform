#!/usr/bin/env bash
# Ejecuta un escenario de carga en el entorno aislado y recopila sus resultados (Fase 3).
#   load-tests/env/run-scenario.sh smoke            # comprobación corta (2 usuarios, 1 minuto)
#   LOADTEST_AUTHORIZED=1 load-tests/env/run-scenario.sh A|B|C|D|E|F|G|H
# Requiere el entorno levantado (ver README.md). Los escenarios distintos de smoke exigen
# LOADTEST_AUTHORIZED=1 para no lanzar pruebas intensivas por accidente.
set -euo pipefail

SCENARIO="${1:?Uso: run-scenario.sh smoke|A|B|C|D|E|F|G|H}"
cd "$(dirname "$0")"
COMPOSE=(docker compose -f docker-compose.yml)

if [[ "$SCENARIO" != "smoke" && "${LOADTEST_AUTHORIZED:-}" != "1" ]]; then
  echo "El escenario $SCENARIO es una prueba de carga: requiere LOADTEST_AUTHORIZED=1." >&2
  exit 2
fi

case "$SCENARIO" in
  smoke|A|B|C|D|E|H) SCRIPT=mixed-workload.js ;;
  F) SCRIPT=file-workload.js ;;
  G) SCRIPT=comments-workload.js ;;
  *) echo "Escenario desconocido: $SCENARIO" >&2; exit 2 ;;
esac

RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$SCENARIO"
HOST_OUT="../results/$RUN_ID"
OUT="/results/$RUN_ID"
mkdir -p "$HOST_OUT"
echo "Resultados en load-tests/results/$RUN_ID"

# H: saturación con el pool reducido; se restaura la configuración por defecto al terminar.
if [[ "$SCENARIO" == "H" ]]; then
  DATABASE_POOL_MAX=2 DATABASE_MAX_WAITING=20 DATABASE_CONNECTION_TIMEOUT_MS=1000 \
    "${COMPOSE[@]}" up -d --wait --force-recreate backend
  trap '"${COMPOSE[@]}" up -d --wait --force-recreate backend' EXIT
fi

# Comprobación previa: cookies, Origin, roles y aislamiento. Sin ella no se mide.
"${COMPOSE[@]}" run --rm tools node load-tests/auth-smoke.mjs > "$HOST_OUT/auth-smoke.json"
"${COMPOSE[@]}" run --rm tools node load-tests/env/integrity-check.mjs --write-baseline="$OUT/integrity-before.json" > /dev/null

SSE_ARGS=()
if [[ "$SCENARIO" == "G" ]]; then
  "${COMPOSE[@]}" run -d --rm --name "arca-loadtest-sse-$RUN_ID" \
    -e SSE_CONNECTIONS="${SSE_CONNECTIONS:-50}" -e SSE_DURATION_MS="${SSE_DURATION_MS:-600000}" \
    -e SSE_RESULT_FILE="$OUT/sse.json" tools node load-tests/sse-probe.mjs > /dev/null
  SSE_ARGS=(--sse="$OUT/sse.json")
fi

K6_EXIT=0
"${COMPOSE[@]}" run --rm -e PROFILE="$SCENARIO" -e DURATION="${DURATION:-}" -e VUS="${VUS:-}" k6 run \
  --summary-export="$OUT/summary.json" --out json="$OUT/raw.json.gz" "$SCRIPT" || K6_EXIT=$?

if [[ "$SCENARIO" == "G" ]]; then
  docker wait "arca-loadtest-sse-$RUN_ID" > /dev/null 2>&1 || true
fi

"${COMPOSE[@]}" run --rm tools node load-tests/env/integrity-check.mjs --baseline="$OUT/integrity-before.json" > "$HOST_OUT/integrity-after.json" || true
"${COMPOSE[@]}" run --rm tools node load-tests/env/collect-results.mjs --scenario="$SCENARIO" \
  --k6-summary="$OUT/summary.json" --k6-raw="$OUT/raw.json.gz" --metrics=/results/backend-metrics.jsonl \
  --integrity="$OUT/integrity-after.json" "${SSE_ARGS[@]}" --out="$OUT/report.json" > /dev/null

echo "Informe: load-tests/results/$RUN_ID/report.json (k6 terminó con código $K6_EXIT)"
exit "$K6_EXIT"
