# Aplicación de finished en Supabase — 14 de octubre de 2026

## Resultado actual

La migración `20261013000000_project_finished_status` está **aplicada en Supabase** después de la autorización explícita del desarrollador para modificar la base. `pnpm verify:db` finalizó con código 0 y `Database schema is up to date`: 22 migraciones aplicadas, ninguna pendiente.

El destino verificado fue la base `postgres` del proyecto `iragryaxvrtucpbolcey`, mediante su pooler de sesión `aws-1-us-east-1.pooler.supabase.com:5432`. No se modificaron variables de conexión, el esquema Prisma ni los archivos de migración en esta aplicación.

## Respaldo y comprobaciones previas

Antes de ejecutar la migración se confirmó que era la única pendiente y que no había intentos fallidos activos. Se guardó un respaldo PostgreSQL 17.6 en formato custom del **esquema public y sus datos**, con `pg_dump --schema=public --format=custom --no-owner --no-privileges`.

El respaldo es local y privado, excluido de Git mediante el `.gitignore` de su carpeta:

```text
Backend/.local-backups/finished-20261014-dc3a3ec45d96471d98a2e8db6020112e/
  public-before-finished.dump
  archive-inventory.txt
  backup-manifest.json
  before-state.json
  after-state.json
  verification.json
```

El archivo mide 145492 bytes. Su SHA-256 es `c28e4ea00916797a33c998f8c84d9189939398bbde5c357a85c9556f1a57fa08`. Se comprobó su inventario mediante `pg_restore --list` y se verificó de nuevo el checksum antes de migrar. Se confirmó la inclusión de los datos de proyectos y `_prisma_migrations`. No se ejecutó una restauración de este respaldo; la prueba de la migración sobre PostgreSQL 17.6 local con datos sintéticos ya había pasado en la tarea anterior.

El alcance del respaldo es `public`; no incluye archivos del almacenamiento de objetos ni los esquemas administrados auth/storage de Supabase. Las opciones indicadas omiten instrucciones de propietarios y privilegios; la migración aplicada no modifica esas propiedades. No se muestran credenciales ni filas privadas en los informes.

Además se capturaron las filas completas de proyectos, etapas, hitos, historial, asignaciones y auditoría. Una comprobación inmediatamente anterior a la aplicación confirmó que seguían iguales y que el SQL preparado conservaba su checksum.

## Ejecución y conservación de datos

Se ejecutó desde Backend:

```powershell
pnpm db:migrate:deploy
```

Prisma aplicó únicamente `20261013000000_project_finished_status`. El SQL renombró la etiqueta del enum en su transacción y normalizó las columnas de códigos del historial, sin UPDATE sobre proyectos. El registro nuevo de `_prisma_migrations` finalizó correctamente y su checksum coincide con el archivo autorizado: `02f2bdc098b5ea7c25a1fad593496a3ae695bf8ae4e0b6b1be91400c353268f3`.

La comparación posterior, en modo de solo lectura, verificó las filas completas contra el respaldo. Solo se admitieron las conversiones exactas de código `completed` a `finished` en las columnas previstas.

| Elemento | Antes | Después |
| --- | --- | --- |
| Proyectos totales | 6 | 6 |
| Proyecto finalizado | 1 con completed | 1 con finished |
| Proyectos en proceso | 5 | 5 |
| Asignaciones de responsables | 11 | 11, mismas filas |
| Registros de auditoría | 23 | 23, mismos snapshots |
| Historial, etapas e hitos | Sin filas | Sin filas, tablas conservadas |
| Fechas, responsables y referencias | Capturados en el respaldo | Conservados exactamente |
| OID de etiquetas del enum | Capturados | Conservados; solo cambia la etiqueta |
| Columnas, dependencias, restricciones, índices, triggers y funciones auditados | Capturados | Sin diferencias |
| Migraciones aplicadas | 21 | 22 |
| Migraciones pendientes | Solo finished | Ninguna |

Se conserva el valor histórico `archived_from_status=in_process` de uno de los proyectos activos. Esta aplicación no corrige datos ajenos al cambio de finalización. El intento histórico revertido de la migración de documentación legal también permanece intacto junto a su intento aplicado correctamente.

## Validación final

- `pnpm verify:db`: correcto, sin pendientes.
- Auditoría posterior: correcta, `transaction_read_only=on`, PostgreSQL 17.6, enum `pending|in_process|finished|cancelled|archived`.
- Comparación de datos y metadatos: correcta, sin pérdidas ni cambios ajenos al estado previsto.
- Lecturas mediante repositorios reales del backend sobre Supabase: seis proyectos, un finished y cinco activos en métricas. La política reconoce al finalizado como elegible para publicación y rechaza cambios operativos con `PROJECT_FINALIZED`. Estas comprobaciones no modificaron visibilidad ni crearon datos de prueba remotos.
- `pnpm verify`: correcto; lint/JSDoc, Prisma validate, 256 pruebas backend aprobadas, 293 frontend aprobadas y build correcto. Las cinco integraciones optativas quedaron desactivadas para evitar escrituras de prueba remotas; la integración de migración local ya había sido validada por separado.

No se usaron `db push`, `migrate reset` ni `migrate dev`. No se hicieron commits ni push, ni se desplegó código a Netlify/Vercel ni se reiniciaron sus servicios. La base quedó preparada para el backend que utiliza finished; las lecturas del código actual fueron verificadas contra ella. Las versiones desplegadas deben corresponder al contrato actualizado, porque un backend antiguo que haga casts SQL a completed deja de ser compatible con el enum renombrado.
