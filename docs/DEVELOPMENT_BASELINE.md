# Baseline de desarrollo

## Verificación local y de PostgreSQL

Ejecutar desde `Backend/`:

```bash
pnpm verify
pnpm verify:db
```

`pnpm verify` ejecuta, en orden, lint de documentación del backend, validación
estática del schema Prisma, tests del backend, tests del frontend y build del
frontend. No consulta PostgreSQL. No incluye el lint del frontend.
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

No se encontraron consumidores de `verify` en los workflows ni scripts del
repositorio. No se modificaron automatizaciones. Un consumidor externo que
necesite comprobar PostgreSQL debe ejecutar también `verify:db`.

## Registro histórico anterior a la separación

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
