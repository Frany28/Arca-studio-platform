# Baseline de desarrollo

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
