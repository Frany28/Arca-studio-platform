# Requisitos del stand publicitario

La sección de [Figma 4384:391847](https://www.figma.com/design/Vy3rWOkJ1WIiDLcPoHbHuQ/ARCA-WEBSITE?node-id=4384-391847) se muestra exclusivamente para `advertising_stand` (Stand publicitario). El diseño también muestra «Stand Publicitario» en el selector de tipo. El catálogo vigente contiene Residencial, Comercial, Corporativo y Stand publicitario. `stands_exhibitions` (Stands y exhibiciones) es un identificador retirado: se conserva para registros históricos, sin reclasificarlos ni ofrecerlo como opción nueva.

## Formulario y contrato

Crear y editar solicitudes admite el bloque `standRequirements` únicamente para `advertising_stand`:

```json
{
  "requirementsStatus": "available",
  "documentTypes": ["exhibitor_manual", "event_regulations"],
  "spaceStatus": "assigned",
  "hasSpacePlans": true
}
```

- `requirementsStatus`: `available`, `in_process`, `unavailable` o null (opcional).
- `documentTypes`: lista sin duplicados de `exhibitor_manual`, `event_regulations`, `stand_technical_specifications`, `other`. Solo admite documentos si `requirementsStatus` es `available`; no exige adjuntos ni una selección mínima.
- `spaceStatus`: `assigned`, `in_process`, `unassigned`, obligatorio para Stand publicitario, como indica el asterisco de Figma.
- `hasSpacePlans`: true, false o null (sin responder), independiente de los planos del inmueble.

Los textos presentes en Figma se conservan. Las alternativas de gestión y no disponibilidad se completaron con autorización expresa del desarrollador porque el nodo no mostraba esas listas abiertas.

Crear solicitudes rechaza `stands_exhibitions`. Editar permite conservarlo únicamente si el registro accesible al usuario ya tiene ese tipo; no permite asignarlo a otro registro. El formulario muestra la etiqueta guardada sin añadirla al menú y permite mantenerla o elegir un tipo vigente. Lecturas, cola, detalle y reenvío conservan el valor histórico; nunca activan requisitos del stand para él.

Al cambiar a otro tipo, el formulario limpia las cuatro respuestas y omite `standRequirements` del payload. Al volver al tipo, la sección comienza vacía. La restauración de solicitudes y la edición aplican la misma limpieza. La API admite omisión o null en los demás tipos y rechaza cualquier objeto, incluso vacío. La respuesta pública incluye `standRequirements: null` para solicitudes sin este bloque. Los contratos existentes, permisos, archivos y documentación legal del inmueble conservan sus reglas.

## Persistencia y administración

La migración `20261008000000_advertising_stand_requirements` añade el valor del enum compartido por solicitudes/proyectos y una columna `stand_requirements JSONB NULL`, sin default ni backfill. Una restricción CHECK impide guardar bloques en cualquier otro tipo. Los datos anteriores permanecen intactos. Aplicar la migración antes de desplegar el backend que consulta esta columna; no se aplica automáticamente a staging.

El repositorio guarda/reemplaza el bloque completo mediante parámetros. Cambiar de tipo en una edición lo sustituye por SQL NULL. La API de cliente y la cola técnica lo devuelven para consulta; el drawer administrativo diferencia información declarada, sin respuesta, no cargada y no aplicable. Los documentos son declaraciones del cliente, pendientes de revisión en la reunión; no se incorporan aprobaciones ni verificaciones automáticas.

## Algoritmo 3.0

El bloque es únicamente informativo: no cambia puntos, pesos, penalizaciones, niveles ni viabilidad financiera. No se añade ninguna pregunta al numerador o denominador de información completada. El nuevo tipo es una respuesta válida del catálogo en la pregunta existente de tipo de proyecto. Las solicitudes anteriores conservan las tres evaluaciones.

## Validación

Las regresiones de contrato comprueban ambos endpoints, tipos vigentes e históricos, opciones inválidas, el error HTTP estandarizado y la lectura/escritura con el transporte PostgreSQL simulado. La comparación de las tres métricas cubre los tipos vigentes, tres estados de inmueble y cinco rangos de inversión, con y sin respuestas informativas. Las regresiones de tipos comprueban por separado que el identificador histórico conserva su lectura, edición y métricas.

Las pruebas de navegador del formulario y workflow comprueban visibilidad exclusiva, limpieza y errores al cambiar de tipo, confirmación, restauración de solicitudes devueltas, envío sin inmueble, detalle administrativo y responsive a 375/768/1440 px en ambos temas. Las capturas se guardan en el directorio temporal del sistema (`arca-stand-requirements`).

`pnpm verify` valida JSDoc, Prisma, pruebas de backend/frontend y compilación. `pnpm --dir Frontend lint` ejecuta el lint visual. Desde Frontend: `node --test tests/browser/projectRequestForm.test.js tests/browser/projectRequestWorkflow.test.js`.

La prueba de migración aislada es optativa: configurar `ARCA_STAND_TEST_DATABASE_URL` con una base local de pruebas y ejecutar desde Backend `node --test tests/projectRequestStand.integration.test.js`. Crea un namespace aislado, ejecuta la migración allí y limpia solamente ese namespace. No usa las credenciales de staging ni modifica sus tablas. No se ejecutó porque no hay PostgreSQL local disponible.

La prueba de repositorios reales se habilita mediante `ARCA_STAND_REPOSITORY_DB_TESTS=1`. Usa la base configurada y una transacción con rollback: comprueba creación idempotente, lectura, edición sin reemplazar `submissionId`, consulta administrativa, limpieza al cambiar de tipo y rechazo por la restricción CHECK para los otros cuatro tipos. Compara el contenido y la cantidad de solicitudes antes y después para comprobar que no quedan datos de prueba. La prueba detectó y permitió corregir un parámetro de `submissionId` sin uso en el SQL de edición; ahora ese parámetro se añade únicamente al crear.

## Estado de aplicación en staging

El 8 de octubre de 2026 se aplicó `20261008000000_advertising_stand_requirements` en la base configurada de Supabase, con autorización expresa del desarrollador y mediante `prisma migrate deploy`. Se verificaron el enum, la columna nullable sin default, la restricción validada y la conservación de las nueve solicitudes anteriores, comparando también el contenido de sus columnas existentes.

La conexión `DIRECT_URL` fallaba por DNS. Para esta ejecución se usó la conexión de sesión de `DATABASE_URL` (puerto 5432) como `DIRECT_URL` solamente en el proceso; no se modificó el archivo `.env`. La prueba de repositorios reales pasó sobre staging y revirtió todos los datos de prueba.
