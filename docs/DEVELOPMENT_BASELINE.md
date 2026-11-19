# Baseline de desarrollo

## Verificación local y de PostgreSQL

Ejecutar desde `Backend/`:

```bash
pnpm verify
pnpm verify:db
```

`pnpm verify` ejecuta, en orden, lint de documentación del backend, lint del
frontend, validación estática del schema Prisma, tests del backend, tests del
frontend y build del frontend. No consulta PostgreSQL. El lint del frontend se
incorporó el 17 de octubre de 2026, cuando quedó en cero errores y advertencias:
cualquier error nuevo hace fallar `verify`.
La configuración Prisma existente sigue requiriendo `DIRECT_URL` o
`DATABASE_URL` configurada para cargar y validar el schema; no exige que el
destino esté disponible ni introduce valores de reemplazo.

`pnpm verify:db` reutiliza `db:migrate:status` para ejecutar
`node scripts/prisma.mjs migrate status`. Requiere un destino PostgreSQL
resoluble, accesible y con credenciales válidas. Prisma conserva la prioridad de
`DIRECT_URL` sobre `DATABASE_URL`, sin fallback automático cuando falla la
conexión. La tarea consulta el estado de migraciones, no las aplica, y conserva
un código de salida distinto de cero ante errores de conexión o de estado.

Para verificar tanto el código local como el estado de la base configurada,
ejecutar ambas tareas. Que `verify` pase no demuestra que las migraciones de esa
base estén actualizadas.

En el diagnóstico del 1 de octubre de 2026, el build frontend y las suites
de 217 tests frontend y 115 tests backend pasan. La consulta de migraciones
falla con `Schema engine error`; la comprobación independiente de conexión
identifica `ENOTFOUND` en el hostname seleccionado por `DIRECT_URL`. No se ha
demostrado un defecto en las migraciones locales.

## Estado al 17 de octubre de 2026

- Backend: 448 tests, 421 aprobados, 0 fallidos y 27 omitidos. Los omitidos son
  pruebas contra PostgreSQL que solo se ejecutan con su variable opt-in.
- Frontend: 311 tests aprobados, 0 fallidos; `pnpm lint` sin errores ni
  advertencias; build correcto.
- `pnpm verify` pasa en una copia limpia sin `.env`, igual que en CI.

### Evolución del número de tests del frontend

Los 312 aprobados y 59 fallidos del registro histórico (371 en total) bajaron a
217 en el diagnóstico del 1 de octubre porque el commit `38ced64` retiró el sitio
público (home, procesos, servicios y vídeo de presentación) junto con sus
assets y sus tests. No se eliminaron tests de funcionalidades vigentes para
ocultar fallos. La cifra actual de 311 corresponde a tests añadidos después.

## Integración continua

`.github/workflows/verify.yml` ejecuta `pnpm verify` en cada pull request y en
cada push a `main`, con una `DATABASE_URL` sintética que solo satisface
`prisma validate`. Para que bloquee merges, marcar el check `verify` como
requerido en la protección de rama de `main`. `verify:db` no forma parte del
workflow porque necesita credenciales reales de PostgreSQL. Un consumidor que
necesite comprobar la base debe ejecutarlo aparte.

## Registro histórico anterior a la separación

> Registro conservado como referencia. Las cifras vigentes están en "Estado al 17 de octubre de 2026".

Baseline verificado el **1 de octubre de 2026**, después de instalar exactamente las dependencias bloqueadas mediante `pnpm install --frozen-lockfile`, sin modificar manifiestos ni lockfiles.

## Backend

- Node: `v22.23.1`
- pnpm: `10.18.2`
- `pnpm install --frozen-lockfile`: correcto
- Tests: **115 aprobados, 0 fallidos**
- `pnpm lint:docs`: correcto

Este es el baseline limpio esperado para Backend.

## Frontend

- `pnpm install --frozen-lockfile`: correcto
- Tests: **312 aprobados, 59 fallidos**
- Lint: **47 errores, 6 advertencias**
- Build: **correcto**

Estos fallos existen antes de iniciar la división formal de responsabilidades y no deben atribuirse automáticamente a cambios futuros. El objetivo futuro del frontend debe ser reducirlos hasta obtener tests y lint limpios. Ningún PR debería aumentar deliberadamente esa deuda. El build actual sí es exitoso.

`pnpm verify` no se ejecutó en esta verificación del baseline porque los tests y el lint del frontend no pasaron; su ejecución estaba condicionada al éxito de todas las comprobaciones previas. No se corrigieron fallos durante el diagnóstico.
