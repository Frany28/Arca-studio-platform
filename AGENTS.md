# Reglas de desarrollo — Sistema Web ARCA Studio

Estas instrucciones son obligatorias para cualquier persona o agente que modifique este repositorio.

Al iniciar cada tarea en este repositorio, leer este `AGENTS.md` y cualquier `AGENTS.md` adicional aplicable al área de trabajo. Aplicar también el proceso de calidad y mantenibilidad de la sección 19 antes de modificar código; estas reglas permanecen vigentes entre sesiones.

> **Estado actual del proyecto:** ARCA Studio se encuentra en fase de desarrollo, pruebas y demostración. Los despliegues actuales realizados mediante Netlify y/o Vercel deben considerarse entornos de **staging/demo/pruebas**, y no el entorno definitivo de producción.

---

# 1. Clasificación de entornos

El proyecto diferencia explícitamente los siguientes entornos:

```text
Localhost                   → Desarrollo local
Netlify / Vercel actuales   → Staging / Demo / Pruebas
Dominio y entorno definitivo → Producción
```

La existencia de un despliegue accesible desde Internet no implica por sí sola que dicho entorno sea producción.

Mientras Netlify o Vercel sean utilizados para:

* pruebas internas;
* revisión por parte del equipo;
* revisión por supervisores;
* demostraciones;
* validación de funcionalidades;
* pruebas de integración;
* revisión de avances;

deben considerarse entornos de **staging/demo**.

Las restricciones exclusivas de producción no deben aplicarse automáticamente a estos despliegues cuando impidan realizar pruebas autorizadas.

---

# 2. Principios

* Preservar la arquitectura modular existente; no introducir microservicios, Redis, MinIO, TypeScript ni cambios de proveedor sin autorización explícita.
* Reutilizar módulos existentes antes de crear lógica nueva.
* No mezclar cambios funcionales con correcciones de lint o refactors ajenos.
* Conservar compatibilidad con endpoints y respuestas exitosas existentes salvo que el cambio esté explícitamente autorizado.
* Se permite utilizar configuraciones temporales necesarias para desarrollo, integración, demostración o despliegues de prueba.
* Se permite trabajar con `.env`, variables del proveedor de despliegue y configuraciones equivalentes.
* Se permite modificar configuraciones de Netlify y Vercel necesarias para realizar pruebas.
* Las restricciones destinadas exclusivamente a producción no deben impedir pruebas controladas.
* Toda solución temporal de desarrollo debe poder identificarse y retirarse antes de producción.

---

# 3. Credenciales y secretos

Debe distinguirse entre:

1. **Secretos reales de infraestructura.**
2. **Credenciales de cuentas reales.**
3. **Credenciales públicas de una cuenta demo.**

No son equivalentes y no deben recibir el mismo tratamiento.

## Secretos reales

Se consideran secretos reales:

* contraseñas de PostgreSQL;
* claves AWS/S3;
* secretos JWT;
* claves privadas SMTP;
* tokens privados de APIs;
* credenciales del VPS;
* claves privadas de servicios externos;
* credenciales administrativas de producción.

Estos valores no deben introducirse deliberadamente en el bundle público del frontend.

## Cuenta demo pública

ARCA Studio puede disponer de una cuenta creada exclusivamente para desarrollo, staging y demostraciones.

Las credenciales de esta cuenta se consideran deliberadamente **públicas y desechables**, y no deben tratarse como secretos.

La cuenta debe estar identificada como:

```text
DEMO
TEST
TESTING
STAGING
SANDBOX
```

o una denominación equivalente.

---

# 4. Cuenta pública de demostración

Mientras ARCA Studio permanezca en desarrollo y los despliegues actuales de Netlify/Vercel sean utilizados como staging/demo, se autoriza una cuenta pública de demostración.

Su objetivo es permitir que las personas autorizadas para revisar el sistema puedan acceder fácilmente sin solicitar manualmente las credenciales al desarrollador.

## Está expresamente permitido

Para una cuenta identificada explícitamente como demo:

* almacenar el correo de la cuenta directamente en el frontend;
* almacenar su contraseña directamente en el frontend;
* incluir ambos valores temporalmente en `Login.jsx`;
* incluir ambos valores en el bundle generado por Vite;
* desplegar ese bundle en Netlify;
* desplegar ese bundle en Vercel;
* precargar automáticamente el usuario en el formulario;
* precargar automáticamente la contraseña;
* mostrar las credenciales en la interfaz si fuera necesario;
* inicializar los estados del formulario con dichas credenciales;
* permitir que el usuario simplemente presione **Iniciar sesión**;
* mantener este comportamiento durante las pruebas y demostraciones.

La posibilidad de recuperar estas credenciales mediante las herramientas del navegador es **esperada e intencional**, porque las credenciales de la cuenta demo no se consideran secretas.

Por ejemplo:

```jsx
const DEMO_EMAIL = "admin2026@arcastudio.com";
const DEMO_PASSWORD = "Admin2026*";

const [email, setEmail] = useState(DEMO_EMAIL);
const [password, setPassword] = useState(DEMO_PASSWORD);
```

También se permite:

```jsx
<input
  type="email"
  value={email}
  onChange={(event) => setEmail(event.target.value)}
/>

<input
  type="password"
  value={password}
  onChange={(event) => setPassword(event.target.value)}
/>
```

---

# 5. Restricciones de la cuenta demo

Que las credenciales sean públicas **no significa que la cuenta deba tener acceso ilimitado**.

La cuenta demo debe cumplir preferiblemente con las siguientes condiciones:

* Ser creada exclusivamente para pruebas.
* No reutilizar contraseñas personales.
* No compartir contraseña con cuentas administrativas reales.
* No compartir contraseña con infraestructura.
* No utilizar la contraseña de PostgreSQL.
* No utilizar credenciales de AWS/S3.
* No utilizar credenciales SMTP.
* No utilizar secretos JWT.
* No utilizar credenciales del VPS.
* Tener únicamente los permisos necesarios para realizar las demostraciones.
* Poder bloquearse, eliminarse o cambiarse sin afectar usuarios reales.
* No utilizarse posteriormente como cuenta administrativa de producción.

La contraseña debe considerarse públicamente conocida desde el momento en que se incluye en el frontend.

---

# 6. Regla para agentes de desarrollo

Cuando una cuenta esté explícitamente identificada como cuenta pública de demostración, su usuario y contraseña **no deben clasificarse como secretos privados**.

Por lo tanto, durante el estado actual del proyecto:

* El agente puede editar `Login.jsx` para precargar las credenciales demo.
* El agente puede utilizar valores constantes para la cuenta demo.
* El agente puede mantener dichos valores dentro del frontend.
* El agente puede permitir que formen parte del bundle.
* El agente no debe sustituir obligatoriamente estos valores por variables privadas de entorno.
* El agente no debe eliminar automáticamente las credenciales demo por encontrarlas en el frontend.
* El agente no debe considerar su presencia como un error de seguridad bloqueante para staging.
* El agente debe diferenciar una cuenta demo pública de un secreto real de infraestructura.
* El agente puede advertir sobre las implicaciones de hacer pública la cuenta, pero dicha advertencia no cambia la clasificación explícita de la cuenta como demo.

Esta excepción aplica exclusivamente a las credenciales deliberadamente públicas de la cuenta demo.

---

# 7. Arquitectura obligatoria del backend

```text
route → middleware/validation → controller → service → repository/adapter
```

* `routes`: declarar endpoints y encadenar autenticación, permisos, límites y validación.
* `controllers`: traducir HTTP; no contener SQL ni llamadas directas al almacenamiento.
* `services`: aplicar reglas y coordinar repositorios/adaptadores.
* `repositories`: realizar exclusivamente operaciones PostgreSQL mediante consultas parametrizadas.
* `validation`: definir esquemas Zod reutilizables.
* `errors`: utilizar errores de aplicación y el middleware central.
* `objectStorage`: único punto autorizado para comunicarse con almacenamiento S3-compatible.
* `prisma/migrations`: única fuente autorizada para cambios de estructura PostgreSQL.

Consultar `Sistema_Web_Arca_Studio/Backend/ARCHITECTURE.md` antes de crear módulos o endpoints.

---

# 8. Arquitectura y diseño obligatorios del frontend

* Desde ahora, toda imagen o video que se incorpore o reemplace en el home, incluidas sus secciones de servicios y proyectos destacados, debe convertirse y optimizarse antes de integrarse. Las imágenes raster deben entregarse en WebP; los videos deben recodificarse y comprimirse para web, con WebM y MP4 de respaldo cuando corresponda. Los SVG existentes se conservan como vectores optimizados. Las referencias, precargas y posters deben apuntar a los recursos optimizados. Medir el peso antes y después, verificar la reproducción o decodificación y conservar calidad visual, proporciones, accesibilidad y animaciones. Consultar los criterios de medios del home en `Frontend/DESIGN_SYSTEM.md`.

* Ninguna animación existente puede eliminarse o desactivarse sin una instrucción explícita del usuario para esa animación. Cambiar spacing, layout, scroll o componentes no autoriza a suprimir animaciones relacionadas. Una petición sobre un efecto concreto se limita a ese efecto; deben conservarse los demás, incluida la navegación animada, los revelados y los recorridos internos. Se mantiene el soporte de accesibilidad existente para movimiento reducido.

* Consultar `Sistema_Web_Arca_Studio/Frontend/DESIGN_SYSTEM.md` antes de crear o modificar páginas, componentes visuales o estilos.
* Reutilizar `Frontend/src/components/ui` y extender sus variantes antes de crear componentes equivalentes.
* Usar los tokens de `Frontend/src/styles/global.css` y las clases de `Frontend/src/styles/typography.css`.
* Evitar valores visuales duplicados.
* Mantener todas las vistas responsive.
* Mantener las vistas accesibles.
* Mantener compatibilidad con tema claro y oscuro.
* Diseñar explícitamente estados de carga, contenido, vacío, error y paginación.
* Centralizar patrones repetidos.

---

# 9. Reutilización obligatoria

Antes de editar código:

1. Leer el `AGENTS.md` aplicable.
2. Consultar los documentos de arquitectura o diseño correspondientes.
3. Buscar implementaciones equivalentes.
4. Identificar componentes, hooks, helpers y servicios existentes.
5. Extender las implementaciones existentes antes de crear otras.
6. Revisar consumidores del flujo compartido.
7. Ejecutar pruebas y compilaciones aplicables.

Antes de implementar lógica nueva, revisar:

* `src/middlewares/validate.js`
* `src/validation/`
* `src/errors/appError.js`
* `src/services/fileUploadService.js`
* `src/services/objectStorage.js`
* `src/utils/pagination.js`
* `src/middlewares/rateLimit.js`
* `src/middlewares/auth.js`
* `src/config/db.js`
* `src/services/projectEvents.js`

Si una regla se utiliza en dos sitios, extraerla a un módulo compartido.

---

# 10. Caché

* Toda lectura repetible debe evaluar el uso de caché cuando sea técnicamente seguro.
* Archivos inmutables deben utilizar URLs versionadas cuando corresponda.
* Las peticiones concurrentes equivalentes deben deduplicarse.
* Todo caché debe definir clave, alcance, duración e invalidación.
* Los recursos protegidos deben aislarse por usuario o sesión.
* No compartir contenido autenticado entre usuarios sin comprobar permisos.
* No almacenar respuestas de autenticación, mutaciones o errores en caché sin una razón explícita.
* Probar invalidación y deduplicación cuando corresponda.

---

# 11. API y datos

* Validar `body`, `params`, `query` y encabezados relevantes.
* Mantener respuestas de error con `code` y `message`.
* Usar `fields` únicamente para errores de validación.
* No devolver mensajes internos de PostgreSQL en respuestas normales.
* No devolver stack traces en respuestas normales.
* Utilizar consultas SQL parametrizadas.
* No concatenar entradas del usuario directamente en SQL.
* Utilizar paginación por cursor en colecciones crecientes.
* Aplicar autenticación y permisos según el endpoint.
* Mantener streaming para archivos cuando corresponda.
* Revisar manualmente las migraciones.
* No utilizar `prisma db push` ni `prisma migrate reset` sobre bases con información que deba conservarse.

La excepción de credenciales públicas definida anteriormente aplica exclusivamente a la cuenta demo.

---

# 12. Libertad para pruebas

Durante desarrollo y staging se permite:

* crear datos de prueba;
* crear cuentas de prueba;
* crear proyectos de prueba;
* utilizar servicios externos autorizados;
* configurar variables de entorno;
* modificar configuraciones de Netlify;
* modificar configuraciones de Vercel;
* utilizar endpoints temporales;
* añadir logs temporales;
* implementar soluciones provisionales;
* utilizar credenciales de una cuenta demo pública;
* precargar las credenciales demo en el login;
* hardcodear temporalmente las credenciales demo en el frontend;
* desplegar dichas credenciales en Netlify/Vercel;
* realizar pruebas de integración.

Una decisión tomada para facilitar desarrollo no debe asumirse automáticamente como válida para producción.

---

# 13. Pruebas y aceptación

Cada funcionalidad debe cubrir, cuando corresponda:

* operación exitosa;
* datos inválidos;
* usuario sin autenticación;
* usuario sin permiso;
* recurso inexistente;
* conflicto o duplicado;
* fallo de PostgreSQL o almacenamiento;
* paginación;
* deduplicación;
* concurrencia para operaciones sensibles.

Antes de entregar cambios ejecutar desde `Backend`:

```powershell
pnpm verify
```

Si no hay acceso a la base de pruebas:

```powershell
pnpm test
pnpm --dir ../Frontend build
```

Documentar cualquier comprobación no ejecutada y su motivo.

---

# 14. Checklist de una funcionalidad nueva

* [ ] Reutiliza módulos compartidos existentes.
* [ ] Incluye esquema Zod para entradas externas cuando corresponda.
* [ ] Usa errores centralizados.
* [ ] Mantiene el controlador pequeño y sin SQL.
* [ ] Coloca reglas de negocio en servicios.
* [ ] Limita repositorios a PostgreSQL.
* [ ] Incluye autenticación y permisos necesarios.
* [ ] Pagina colecciones mediante cursor.
* [ ] Incluye pruebas relevantes.
* [ ] Revisa migraciones Prisma.
* [ ] Actualiza documentación cuando cambia un contrato.
* [ ] Identifica configuraciones temporales.
* [ ] Las credenciales públicas corresponden exclusivamente a una cuenta demo.
* [ ] No se utilizan secretos de infraestructura como credenciales demo.
* [ ] `pnpm verify` finaliza correctamente o se documenta el motivo.

---

# 15. Paso futuro a producción

Los despliegues actuales en Netlify/Vercel **no deben considerarse automáticamente producción** mientras estén destinados a pruebas y demostraciones.

Cuando ARCA Studio pase oficialmente a producción se deberá realizar una revisión específica.

Como mínimo:

1. Eliminar las credenciales demo hardcodeadas del frontend.
2. Eliminar usuario y contraseña precargados del formulario.
3. Bloquear, eliminar o modificar la cuenta demo.
4. Rotar su contraseña.
5. Revisar permisos.
6. Revisar variables de entorno.
7. Revisar configuraciones de Netlify/Vercel que continúen utilizándose.
8. Verificar que secretos privados no formen parte del bundle.
9. Revisar logs.
10. Revisar acceso a archivos y datos.
11. Aplicar las restricciones definitivas de producción.

---

# 16. Regla vigente para ARCA Studio

Actualmente ARCA Studio se encuentra en:

```text
DESARROLLO + STAGING + DEMOSTRACIÓN
```

Los despliegues actuales mediante Netlify y Vercel forman parte de ese proceso.

Por tanto, mientras esta clasificación permanezca vigente:

> **Se autoriza expresamente mantener una cuenta demo pública con usuario y contraseña precargados en el formulario de inicio de sesión de los despliegues de Netlify/Vercel.**

Estas credenciales se consideran deliberadamente públicas y no constituyen un secreto del sistema.

Esta excepción existe para facilitar las pruebas y demostraciones de ARCA Studio y deberá eliminarse antes de considerar el sistema listo para producción.

---

# 17. Autoridad del desarrollador

Cada regla indicada en este documento puede ser modificada, suspendida o revertida mediante una instrucción explícita del desarrollador responsable del proyecto.

> **El desarrollador puede revertir cualquiera de estas reglas, sin excepciones.**

---

# 18. Documentación JSDoc del backend

Toda función o método existente o nuevo dentro de `Backend/src` debe incluir un bloque JSDoc escrito en español inmediatamente antes de su declaración.

* La descripción inicial debe ocupar dos o tres líneas y explicar el propósito funcional, no limitarse a repetir el nombre del elemento.
* Se deben documentar funciones declaradas, métodos, constructores, helpers privados y funciones asignadas a constantes o propiedades.
* Deben incluirse `@param`, `@returns` y `@throws` únicamente cuando correspondan, con tipos y descripciones claros.
* Las funciones asíncronas que retornan un valor deben expresar su resultado como `Promise<T>`.
* La descripción debe mencionar reglas de negocio o efectos secundarios relevantes, como acceso a PostgreSQL, almacenamiento, correo, caché o publicación de eventos.
* Los callbacks anónimos simples quedan exentos. Si un callback concentra lógica relevante, debe extraerse como función nombrada y documentarse.
* Todo cambio de comportamiento debe actualizar también el JSDoc relacionado.
* `pnpm lint:docs` y `pnpm verify` deben rechazar funciones o métodos que incumplan la estructura verificable de esta regla.

---

# 19. Calidad arquitectónica, mantenibilidad y proceso de trabajo

Trabajar como responsable de la estabilidad del proyecto a largo plazo. Toda solución debe ser funcional, clara, mantenible, comprobable, extensible, coherente con la arquitectura, documentada y segura frente a regresiones. No resolver únicamente el síntoma visible ni acumular deuda técnica para hacer desaparecer un problema.

## 19.1. Análisis previo y causa raíz

Antes de escribir código:

1. Analizar el flujo completo: dónde nace el estado, dónde se transforma y dónde se consume.
2. Identificar componentes, hooks, servicios, helpers, endpoints y pruebas que participan.
3. Buscar implementaciones equivalentes y revisar los módulos compartidos pertinentes antes de crear lógica nueva.
4. Determinar la causa raíz y revisar los contratos y todos los consumidores de las interfaces compartidas que se pretenda cambiar.
5. Antes de un cambio importante, explicar brevemente el problema real, su causa, los archivos involucrados, los riesgos, la solución propuesta y por qué resuelve el problema de forma estructural.

Si la causa es una distribución incorrecta de responsabilidades, corregirla de forma segura e incremental dentro del alcance de la tarea.

## 19.2. Responsabilidades y tamaño de los módulos

* Cada componente, hook, servicio, controlador o helper debe tener una responsabilidad comprensible. Preferir composición antes que acumulación de funciones.
* Antes de agregar lógica a un archivo grande, enumerar sus responsabilidades, identificar cuáles pueden separarse y explicar la división propuesta.
* Extraer por responsabilidad, no por cantidad de líneas. Mover un archivo grande a otro archivo grande no resuelve el problema.
* Separar cuando corresponda presentación, estado, HTTP, transformaciones, validaciones, reglas de negocio, eventos, sincronización, caché, permisos y configuración.
* Los componentes React deben centrarse en composición, presentación, conexión entre hooks y renderizado. Extraer lógica de negocio compleja, transformaciones extensas y efectos de responsabilidades independientes.
* Los hooks deben tener una intención clara. No trasladar toda la complejidad de un componente a un hook que mezcle networking, validación, caché, permisos, navegación y estado visual; componer responsabilidades independientes.
* Mantener la comunicación HTTP separada de la presentación. Las funciones HTTP deben tener nombres explícitos, interfaces consistentes y manejo de errores, sin comportamiento visual.
* Distribuir servicios HTTP por dominio cuando mejore la responsabilidad y la navegación del código, no únicamente por estética.
* Separar reglas de dominio de infraestructura cuando sea posible, para probar el negocio sin depender de HTTP, almacenamiento local, SSE, WebSocket o servicios externos.
* Mantener las piezas relacionadas cerca y una estructura predecible. Usar carpetas por funcionalidad cuando el alcance lo justifique; evitar carpetas innecesarias para archivos triviales.
* No hacer extracciones artificiales que dificulten seguir el flujo. Cada extracción debe mejorar responsabilidad, claridad, reutilización, pruebas, aislamiento o mantenibilidad.

## 19.3. Claridad, reutilización y documentación

* Usar nombres que expresen intención y dominio; evitar nombres ambiguos como `stuff`, `handler2`, `processData` o `helpers2`.
* Cada función debe resolver una responsabilidad concreta. Preferir retornos tempranos y validaciones separadas frente a anidación excesiva, sin fragmentar artificialmente el código.
* Buscar helpers, validadores, servicios y componentes equivalentes antes de crear otros. Aplicar DRY con criterio, sin abstracciones genéricas para coincidencias superficiales.
* Usar constantes para valores que representan conceptos importantes y cuya dispersión dificulta el mantenimiento; no convertir cada literal trivial en una constante.
* Documentar con JSDoc todo código no trivial, especialmente funciones reutilizables, hooks, helpers, servicios, transformaciones, validadores, caché y efectos secundarios. Mantener la regla más específica de la sección 18 para `Backend/src`.
* El JSDoc debe explicar propósito, entradas, resultado, efectos secundarios, condiciones relevantes y errores esperados cuando correspondan. Actualizarlo si cambia el comportamiento.
* Documentar decisiones que no sean evidentes: abortos, caché, dependencias de efectos, timeouts, listeners, descarte de respuestas antiguas y elección de mecanismos de sincronización.
* Los comentarios deben explicar el motivo de una decisión, no repetir literalmente el código.

## 19.4. Estado, efectos, asincronía y errores

* Evitar estado duplicado: derivar valores del estado existente cuando sea posible.
* No usar efectos para sincronizar estados que pueden calcularse directamente. Controlar dependencias y limpiar listeners y timers.
* En operaciones asíncronas, considerar cancelación, concurrencia, respuestas fuera de orden, desmontaje, errores, carga y operaciones repetidas. Evitar que respuestas obsoletas sobrescriban datos recientes.
* Si la solución acumula flags, booleanos relacionados, condiciones repetidas o efectos interdependientes, simplificar la representación del problema antes de agregar más estados.
* No ocultar errores silenciosamente. Propagarlos, transformarlos, registrarlos o manejarlos según la responsabilidad del módulo; documentar cualquier descarte deliberado.
* Mantener mensajes y códigos consistentes. No sustituir errores específicos por mensajes genéricos que dificulten el diagnóstico.

## 19.5. Alcance, compatibilidad y mejora gradual

* Mantener cambios enfocados y fáciles de revisar. No mezclar una corrección con formateos, lint o refactors ajenos.
* No hacer un refactor masivo del repositorio. Mejorar progresivamente el área relacionada con cada tarea.
* Antes de modificar una interfaz compartida, revisar todos sus consumidores, contratos, pruebas e impacto; conservar compatibilidad salvo autorización explícita.
* Clasificar problemas encontrados: los directamente relacionados pueden corregirse en el mismo cambio; los indirectamente relacionados solo si reducen significativamente el riesgo; los no relacionados se reportan como deuda técnica para otra tarea.
* En archivos con demasiadas responsabilidades, realizar extracciones incrementales, adaptar las pruebas y comprobar que el comportamiento público continúa siendo el mismo.

## 19.6. Validación y revisión del cambio

* Revisar las pruebas relacionadas antes de modificar y ejecutar pruebas específicas y relacionadas después del cambio.
* Cuando se corrige un bug, agregar una prueba de regresión que lo hubiera detectado cuando corresponda. Las pruebas deben comprobar comportamiento y evitar dependencia innecesaria de detalles internos.
* Adaptar las pruebas si cambia una responsabilidad interna sin cambiar el comportamiento público.
* Ejecutar lint disponible, build cuando el alcance lo justifique y las comprobaciones exigidas por la sección 13. Documentar cualquier comprobación no ejecutada y su motivo.
* Revisar explícitamente los casos aplicables: flujo normal, límites, errores, carga inicial, desmontaje, navegación, respuestas lentas, solicitudes repetidas, estados vacíos y permisos.
* Antes de entregar, revisar el propio cambio buscando duplicación, funciones o componentes excesivos, hooks sobrecargados, estado y efectos innecesarios, nombres ambiguos, documentación ausente, manejo incorrecto de errores, condiciones de carrera y código muerto.

## 19.7. Proceso y reporte esperado

Para cada tarea:

1. **Análisis:** explicar causa raíz, archivos involucrados, riesgos y solución propuesta antes de cambios importantes.
2. **Implementación:** mantener responsabilidades claras, nombres explícitos, JSDoc, estructura limpia y compatibilidad.
3. **Validación:** ejecutar las pruebas y comprobaciones aplicables y revisar su resultado.
4. **Revisión:** inspeccionar el cambio por claridad, documentación, errores, concurrencia y regresiones.
5. **Reporte final:** indicar el problema encontrado, los cambios y archivos modificados, las pruebas ejecutadas y sus resultados, las comprobaciones omitidas con su motivo y cualquier deuda técnica adicional relevante.

## 19.8. Orden de prioridad

1. Correctitud.
2. No generar regresiones.
3. Arquitectura clara.
4. Código mantenible.
5. Pruebas.
6. Documentación.
7. Rendimiento cuando sea relevante.
8. Reducción de código.

Menos líneas no implica mejor código. Entre soluciones válidas, preferir la que conserve mejor las responsabilidades, reduzca acoplamiento y futuros bugs, facilite pruebas y sea coherente con ARCA Studio. El criterio de aceptación incluye que el siguiente desarrollador pueda comprender y mantener la solución con confianza.
