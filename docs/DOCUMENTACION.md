# Documentacion del proyecto - Sistema Web Arca Studio

Actualizado al estado actual del repositorio.

## 1. Resumen

Sistema Web Arca Studio es una aplicacion web para gestionar proyectos de arquitectura/interiorismo. El producto separa experiencia de cliente y experiencia de arquitecto/administrador, con autenticacion, dashboards, detalle de proyectos, solicitudes, archivos, comentarios, renders, videos, seguimiento, garantias y configuraciones de usuario.

```text
Sistema_Web_Arca_Studio/
  Frontend/   Aplicacion React + Vite
  Backend/    API Node.js + Express
  netlify.toml
```

## 2. Arquitectura

### Frontend

SPA en React con React Router. Responsabilidades principales:

- Login, recuperacion, restablecimiento y cambio de contrasena.
- Dashboard para clientes.
- Dashboard para arquitectos y administradores.
- Flujo de nuevo proyecto/solicitud.
- Detalle de proyecto con paneles de informacion, documentos, renders, videos, seguimiento y garantias.
- Comentarios y visualizacion de archivos.
- Configuracion de perfil, preferencias, seguridad y soporte.
- Sincronizacion de tema visual.
- Consumo de API REST.

### Backend

API REST en Express. Responsabilidades principales:

- Autenticacion por token y cookie.
- Autorizacion por roles y permisos.
- Rate limit para acciones sensibles.
- Conexion a PostgreSQL.
- Acceso a Supabase Storage compatible con S3.
- Upload, descarga y eliminacion de archivos.
- Comentarios de proyecto y eventos SSE.
- Recuperacion de contrasena via Resend.
- Proxy autenticado para Geoapify.
- Seguridad HTTP con Helmet, CORS y validacion de origen confiable.

## 3. Stack tecnico

### Frontend

- React `^19.2.4`.
- React DOM `^19.2.4`.
- Vite `^8.0.1`.
- Tailwind CSS `^4.2.2`.
- React Router DOM `^7.13.2`.
- Iconsax React `^0.0.8`.
- Three.js `^0.183.2`.
- `@google/model-viewer` `^4.3.1`.
- ESLint `^9.39.4`.

### Backend

- Node.js `22.x`.
- Express `^5.2.1`.
- PostgreSQL con `pg` `^8.21.0`.
- Supabase JS `^2.49.4`.
- AWS SDK S3 Client `^3.1068.0`.
- bcrypt `^6.0.0`.
- cors `^2.8.6`.
- helmet `^8.2.0`.
- dotenv `^17.4.2`.

### Servicios externos

- Supabase: base de datos y storage compatible con S3.
- Geoapify: autocomplete/reverse geocoding.
- Resend: correos de recuperacion de contrasena.
- Netlify: despliegue del frontend.
- Vercel: despliegue del backend serverless.

## 4. Scripts

### Frontend

```bash
pnpm run dev
pnpm run build
pnpm run lint
pnpm run preview
```

- `dev`: inicia Vite con `--host`.
- `build`: genera build de produccion.
- `lint`: ejecuta ESLint.
- `preview`: sirve el build localmente.

### Backend

```bash
pnpm run dev
pnpm run start
pnpm run check:user-login
pnpm run user:set-status
```

- `dev`: inicia `local.js`.
- `start`: inicia `local.js`.
- `check:user-login`: ejecuta `scripts/check-user-login.mjs`.
- `user:set-status`: ejecuta `scripts/set-user-status.mjs`.

Tambien existen scripts operativos en `Backend/scripts/` para inspeccion de esquema, autenticacion, permisos, usuarios, proyectos, carga de archivos/modelos, publicacion, coordenadas y preparacion de tablas.

## 5. Estructura del frontend

```text
Frontend/
  public/
  src/
    api/
    assets/
    auth/
    components/
    hooks/
    layouts/
    pages/
    styles/
    utils/
    main.jsx
    index.css
    theme-init.js
  vite.config.js
  eslint.config.js
  package.json
```

Modulos relevantes:

- `src/api/http.js`: cliente HTTP centralizado.
- `src/auth/AuthContext.jsx`: estado de sesion.
- `src/auth/ProtectedRoute.jsx`: rutas autenticadas y por rol.
- `src/auth/PublicOnlyRoute.jsx`: redireccion de usuarios autenticados fuera de login.
- `src/components/ui/`: biblioteca local de componentes.
- `src/components/ui/Gallery/`: visores de imagenes, videos y modelos 3D.
- `src/pages/architect-dashboard/`: dashboard y flujo de nuevo proyecto.
- `src/pages/projects/`: detalle y paneles de proyecto.
- `src/pages/settings/`: perfil, preferencias, seguridad y soporte.
- `src/utils/geoapify.js`: busqueda de direcciones via backend.

### Rutas frontend

Definidas en `Frontend/src/main.jsx`.

| Ruta                                                      | Acceso                    | Vista                    |
| --------------------------------------------------------- | ------------------------- | ------------------------ |
| `/`                                                       | Publica solo sin sesion   | Login                    |
| `/cuenta-inactiva`                                        | Publica                   | Cuenta inactiva          |
| `/recuperar-cuenta`                                       | Publica                   | Recuperacion             |
| `/nueva-contraseña`                                       | Publica                   | Nueva contrasena         |
| `/dashboard-clientes`                                     | Rol `client`              | Dashboard cliente        |
| `/dashboard-clientes-vacio`                               | Rol `client`              | Estado vacio cliente     |
| `/dashboard-arquitecto`                                   | Rol `admin` o `architect` | Dashboard arquitecto     |
| `/dashboard-arquitecto/nuevo-proyecto`                    | Rol `admin` o `architect` | Nuevo proyecto           |
| `/dashboard-arquitecto-vacio`                             | Rol `admin` o `architect` | Estado vacio arquitecto  |
| `/proyectos/:projectId`                                   | Autenticado               | Detalle de proyecto      |
| `/configuraciones`                                        | Autenticado               | Configuraciones          |
| `/proyectos/quinta-bella-vista/renders-imagenes-vacio`    | Autenticado               | Estado vacio renders     |
| `/proyectos/quinta-bella-vista/informacion-general-vacio` | Autenticado               | Estado vacio informacion |
| `/proyectos/quinta-bella-vista/documentos-vacio`          | Autenticado               | Estado vacio documentos  |
| `/proyectos/quinta-bella-vista/seguimiento-vacio`         | Autenticado               | Estado vacio seguimiento |
| `/proyectos/quinta-bella-vista/garantias-vacio`           | Autenticado               | Estado vacio garantias   |

Nota: el codigo fuente actual usa el path `/nueva-contraseña`. Si se quiere URL ASCII, hay que cambiar ruta, enlaces y URL generada por recuperacion.

## 6. Estructura del backend

```text
Backend/
  api/
    index.js
  scripts/
  src/
    config/
    controllers/
    middlewares/
    repositories/
    routes/
    services/
    utils/
    app.js
  local.js
  vercel.json
  package.json
```

Capas:

- `src/app.js`: configura Express y monta rutas.
- `src/routes/`: rutas HTTP.
- `src/controllers/`: requests/responses.
- `src/repositories/`: consultas de datos.
- `src/middlewares/`: auth, origen confiable y rate limit.
- `src/services/`: eventos y correo.
- `src/config/`: CORS, base de datos, auth y storage.
- `src/utils/`: tokens, cookies y slugs.

Middlewares globales:

- `helmet()`.
- `cors(corsOptions())`.
- `express.json({ limit: "100kb" })`.
- `loadSession`.
- `requireTrustedOrigin`.

## 7. API backend

Base local esperada:

```text
http://localhost:3000/api
```

### Salud

| Metodo | Endpoint               | Descripcion             |
| ------ | ---------------------- | ----------------------- |
| GET    | `/api/health`          | Estado basico de la API |
| GET    | `/api/health/database` | Verifica PostgreSQL     |

### Autenticacion

Base: `/api/auth`

| Metodo | Endpoint              | Proteccion        | Descripcion                      |
| ------ | --------------------- | ----------------- | -------------------------------- |
| POST   | `/login`              | Rate limit        | Login                            |
| POST   | `/forgot-password`    | Rate limit        | Solicita recuperacion            |
| POST   | `/verify-reset-token` | Rate limit        | Verifica token                   |
| POST   | `/reset-password`     | Rate limit        | Restablece contrasena            |
| POST   | `/change-password`    | Auth + rate limit | Cambia contrasena                |
| POST   | `/profile-photo`      | Auth + raw image  | Sube foto de perfil JPG/PNG/WebP |
| GET    | `/me`                 | Auth              | Devuelve usuario actual          |
| POST   | `/logout`             | Publica           | Cierra sesion                    |

### Administracion

Base: `/api/admin`. Requiere rol `admin`.

| Metodo | Endpoint                       | Descripcion                |
| ------ | ------------------------------ | -------------------------- |
| GET    | `/roles`                       | Lista roles                |
| GET    | `/permissions`                 | Lista permisos             |
| GET    | `/roles-permissions`           | Matriz rol-permiso         |
| GET    | `/roles/:roleCode/permissions` | Permisos de un rol         |
| PUT    | `/roles/:roleCode/permissions` | Actualiza permisos del rol |

### Proyectos

Base: `/api/projects`

| Metodo | Endpoint                            | Proteccion                | Descripcion                       |
| ------ | ----------------------------------- | ------------------------- | --------------------------------- |
| GET    | `/?scope=accessible|owned`          | Auth + `projects.read`    | Lista proyectos accesibles o vinculados directamente al usuario |
| GET    | `/:projectId`                       | Auth + `projects.read`    | Detalle de proyecto               |
| GET    | `/:projectId/comments`              | Auth                      | Lista comentarios                 |
| GET    | `/:projectId/events`                | Auth                      | Stream SSE de comentarios         |
| POST   | `/:projectId/comments`              | Auth                      | Crea comentario                   |
| GET    | `/:projectId/files/:fileId/comments` | Auth                     | Lista observaciones de una versión de documento |
| GET    | `/:projectId/files/:fileId/content` | Auth + `projects.read`    | Stream/descarga de archivo        |
| PATCH  | `/:projectId/publication`           | Auth + `projects.publish` | Actualiza publicacion/visibilidad |

### Observaciones generales del entorno

Base: `/api/environment-comments`. No requieren un proyecto vinculado. Un usuario ve las conversaciones cuyo autor raíz comparte al menos un proyecto con él; el administrador ve todas.

| Metodo | Endpoint | Proteccion | Descripcion |
| ------ | -------- | ---------- | ----------- |
| GET    | `/`      | Auth       | Lista las observaciones generales del entorno del usuario |
| POST   | `/`      | Auth + limite de frecuencia | Crea una observacion general o una respuesta |
| GET    | `/authors/:userId/profile-photo` | Auth | Obtiene el avatar solo cuando el autor es visible por proyectos compartidos |

### Solicitudes de proyecto

Base: `/api/project-requests`

| Metodo | Endpoint                           | Proteccion        | Descripcion         |
| ------ | ---------------------------------- | ----------------- | ------------------- |
| POST   | `/`                                | Auth + límite de frecuencia | Crea o recupera un borrador idempotente |
| PATCH  | `/:projectRequestId`               | Auth + límite de frecuencia | Actualiza un borrador propio |
| POST   | `/:projectRequestId/files`         | Auth + raw upload | Sube adjunto        |
| DELETE | `/:projectRequestId/files/:fileId` | Auth              | Elimina adjunto     |
| POST   | `/:projectRequestId/submit`         | Auth + límite de frecuencia | Calcula compatibilidad y envía el borrador a revisión |

La creación exige un `submissionId` UUID y valores normalizados del cuestionario. El cliente no puede establecer estado, puntuación, identidad del cliente ni códigos de verificación. La respuesta final incluye únicamente el puntaje, nivel y observaciones públicas calculadas por el servidor.

Los adjuntos se transmiten por streaming y aceptan JPEG, PNG, PDF y MP4. Se valida nombre, extensión, MIME, firma binaria, máximo de 50 MB por archivo, 10 archivos y 200 MB por solicitud.

### Geoapify

Base: `/api/geoapify`

| Metodo | Endpoint                     | Proteccion | Descripcion              |
| ------ | ---------------------------- | ---------- | ------------------------ |
| GET    | `/address-suggestions?q=...` | Auth       | Sugerencias de direccion |

## 8. Autenticacion y autorizacion

El sistema usa:

- Token propio generado por backend.
- Cookie de sesion configurable.
- Header `Authorization: Bearer <token>`.
- Persistencia frontend en memoria, `sessionStorage` y `localStorage`.
- Broadcast de logout entre pestanas usando `localStorage`.
- Roles: `client`, `architect`, `admin`.
- Permisos como `projects.read` y `projects.publish`.

Variables principales:

- `AUTH_TOKEN_SECRET`.
- `AUTH_COOKIE_NAME`.
- `AUTH_COOKIE_SAMESITE`.
- `AUTH_COOKIE_SECURE`.
- `AUTH_TOKEN_EXPIRES_IN_SECONDS`.
- `AUTH_LOGIN_RATE_LIMIT_MAX`.
- `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS`.

En produccion, `AUTH_TOKEN_SECRET` es obligatorio.

## 9. Variables de entorno

### Frontend

| Variable           | Requerida | Descripcion                                                        |
| ------------------ | --------- | ------------------------------------------------------------------ |
| `VITE_API_URL`     | No        | URL base de la API. Dev: `http://localhost:3000/api`; prod: `/api` |
| `DEPLOY_BASE_PATH` | No        | Base path para Vite                                                |

### Backend - servidor

| Variable                | Requerida | Default    | Descripcion                            |
| ----------------------- | --------- | ---------- | -------------------------------------- |
| `PORT`                  | No        | `3000`     | Puerto local                           |
| `NODE_ENV`              | No        | -          | Ambiente                               |
| `FILE_UPLOAD_LIMIT`     | No        | `50mb`     | Limite de `express.raw` en solicitudes |
| `FILE_UPLOAD_MAX_BYTES` | No        | `52428800` | Validacion de tamano en controlador    |
| `ROUTE_AUTH_DISABLED_FOR_TESTS` | No | `false` | Desactiva auth solo para pruebas locales controladas |

### Backend - base de datos

| Variable                           | Requerida | Default | Descripcion                  |
| ---------------------------------- | --------- | ------- | ---------------------------- |
| `DATABASE_URL`                     | Si        | -       | Connection string PostgreSQL |
| `DATABASE_SSL`                     | No        | `true`  | Activa SSL si no es local    |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | No        | `false` | Valida certificado           |
| `DATABASE_SSL_CA_CERT`             | No        | -       | Certificado CA               |
| `DATABASE_POOL_MAX`                | No        | `10`    | Maximo de conexiones         |
| `DATABASE_IDLE_TIMEOUT_MS`         | No        | `30000` | Timeout idle                 |
| `DATABASE_CONNECTION_TIMEOUT_MS`   | No        | `5000`  | Timeout de conexion          |

### Backend - CORS y origen confiable

| Variable                       | Requerida | Default                        | Descripcion                            |
| ------------------------------ | --------- | ------------------------------ | -------------------------------------- |
| `CORS_ORIGIN` / `CORS_ORIGINS` | No        | `http://localhost:5173`        | Origenes permitidos separados por coma |
| `CORS_ALLOWED_HEADERS`         | No        | Headers base                   | Headers adicionales                    |
| `CORS_ALLOW_NO_ORIGIN`         | No        | `true` en dev, `false` en prod | Permite requests sin origin            |
| `CORS_CREDENTIALS`             | No        | `true`                         | Permite credenciales                   |
| `CSRF_ALLOW_NO_ORIGIN`         | No        | `true` en dev, `false` en prod | Permite mutaciones sin origin          |

### Backend - auth y usuarios de prueba

| Variable                          | Requerida  | Default                                              | Descripcion                           |
| --------------------------------- | ---------- | ---------------------------------------------------- | ------------------------------------- |
| `AUTH_TOKEN_SECRET`               | Si en prod | Aleatorio en dev                                     | Secreto de tokens                     |
| `AUTH_COOKIE_NAME`                | No         | `__Host-arca_session` en prod, `arca_session` en dev | Nombre de cookie                      |
| `AUTH_COOKIE_SAMESITE`            | No         | `None` en prod, `Lax` en dev                         | SameSite                              |
| `AUTH_COOKIE_SECURE`              | No         | Segun `NODE_ENV`                                     | Cookie segura                         |
| `AUTH_LOGIN_RATE_LIMIT_MAX`       | No         | `5`                                                  | Intentos maximos                      |
| `AUTH_LOGIN_RATE_LIMIT_WINDOW_MS` | No         | `900000`                                             | Ventana rate limit                    |
| `AUTH_TOKEN_EXPIRES_IN_SECONDS`   | No         | `43200`                                              | Duracion del token                    |
| `PUBLIC_TEST_USER_ID`             | No         | `1`                                                  | Usuario de prueba si no hay token     |
| `PUBLIC_TEST_CLIENT_ID`           | No         | `null`                                               | Cliente asociado al usuario de prueba |

### Backend - Supabase Storage S3

| Variable                                | Requerida       | Default     | Descripcion            |
| --------------------------------------- | --------------- | ----------- | ---------------------- |
| `SUPABASE_STORAGE_S3_ACCESS_KEY_ID`     | Si              | -           | Access key S3          |
| `SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY` | Si              | -           | Secret key S3          |
| `SUPABASE_STORAGE_S3_ENDPOINT`          | Si              | -           | Endpoint S3            |
| `SUPABASE_STORAGE_S3_REGION`            | No              | `us-east-1` | Region                 |
| `SUPABASE_STORAGE_BUCKET`               | Segun operacion | `null`      | Bucket                 |
| `SUPABASE_URL`                          | No              | -           | URL publica para links |

### Backend - Geoapify

| Variable                | Requerida        | Descripcion                   |
| ----------------------- | ---------------- | ----------------------------- |
| `GEOAPIFY_API_KEY`      | Si para busqueda | API key                       |
| `VITE_GEOAPIFY_API_KEY` | Alternativa      | Fallback aceptado por backend |

### Backend - Resend y recuperacion

| Variable                            | Requerida              | Default                          | Descripcion         |
| ----------------------------------- | ---------------------- | -------------------------------- | ------------------- |
| `RESEND_API_KEY`                    | Si para enviar correos | -                                | API key             |
| `MAIL_FROM`                         | Si para enviar correos | -                                | Remitente           |
| `RESEND_FROM_EMAIL`                 | Alternativa            | -                                | Remitente fallback  |
| `PASSWORD_RESET_EXPIRES_IN_SECONDS` | No                     | `900`                            | Duracion del enlace |
| `FRONTEND_URL`                      | No                     | `https://arcastudio.netlify.app` | Base URL de reset   |
| `PUBLIC_APP_URL`                    | Alternativa            | -                                | Fallback            |
| `APP_URL`                           | Alternativa            | -                                | Fallback            |

### Backend - scripts

| Variable               | Uso                    |
| ---------------------- | ---------------------- |
| `TEST_USER_EMAIL`      | `upsert-test-user.mjs` |
| `TEST_USER_PASSWORD`   | `upsert-test-user.mjs` |
| `TEST_USER_FIRST_NAME` | `upsert-test-user.mjs` |
| `TEST_USER_LAST_NAME`  | `upsert-test-user.mjs` |
| `TEST_USER_PHONE`      | `upsert-test-user.mjs` |
| `TEST_USER_ROLE`       | `upsert-test-user.mjs` |

## 10. Base de datos

No hay migraciones SQL versionadas visibles en el repositorio. El modelo se infiere desde repositorios y scripts:

- Usuarios.
- Roles.
- Permisos.
- Matriz rol-permiso.
- Proyectos.
- Detalle de proyectos.
- Solicitudes de proyecto.
- Comentarios de proyecto.
- Archivos y versiones.
- Tokens/registros de recuperacion de contrasena.
- Visibilidad/publicacion de proyectos.
- Coordenadas/ubicacion.

Scripts utiles:

- `inspect-schema.mjs`.
- `inspect-auth.mjs`.
- `inspect-roles-permissions.mjs`.
- `ensure-file-upload-permissions.mjs`: crea/activa permisos de subida y soporte para `admin`, `architect` y `client`.
- `inspect-projects-schema.mjs`.
- `ensure-project-detail-tables.mjs`.
- `ensure-project-location-coordinates.mjs`.
- `ensure-project-publication.mjs`.
- `ensure-project-public-slugs.mjs`.
- `create-password-reset-table.mjs`.
- `seed-project-visibility-examples.mjs`.

## 11. Archivos y storage

La gestion de archivos usa Supabase Storage compatible con S3.

Funciones actuales:

- Sanitizacion de nombres de archivo.
- Construccion de keys por entidad, usuario, fecha, archivo y version.
- Upload de adjuntos en solicitudes de proyecto.
- Upload de foto de perfil.
- Eliminacion de adjuntos.
- Stream/descarga de archivos de proyecto.
- URL publica cuando `SUPABASE_URL` y `SUPABASE_STORAGE_BUCKET` estan configurados.

Patron de key:

```text
{belongsTo}/{parentId}/users/{ownerId}/{year}/{month}/files/{fileId}/v{versionNumber}/{safeName}
```

## 12. Seguridad

Medidas implementadas:

- `helmet` para cabeceras HTTP.
- CORS con origenes configurables.
- Validacion de origen confiable para mutaciones.
- Cookies configurables para produccion.
- Tokens con expiracion.
- Rate limit en login, recuperacion y cambio de contrasena.
- Restriccion por autenticacion, rol y permisos.
- CSP y cabeceras de seguridad en `netlify.toml`.
- `X-Frame-Options: DENY`.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` restrictiva.

## 13. Despliegue

### Frontend - Netlify

Configuracion en `netlify.toml`:

```toml
[build]
  base = "Frontend"
  command = "pnpm run build"
  publish = "dist"
```

Incluye redirect SPA:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Tambien define cabeceras de seguridad y CSP.

### Backend - Vercel

Configuracion en `Backend/vercel.json`:

```json
{
  "installCommand": "pnpm install",
  "buildCommand": null,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/api"
    }
  ]
}
```

Entrypoint serverless:

```text
Backend/api/index.js
```

Desarrollo local:

```text
Backend/local.js
```

## 14. Convenciones observadas

- Componentes reutilizables en `src/components/ui/`.
- Muchos componentes tienen archivos `Config` y `ShowcaseData`.
- Estados vacios para dashboards y paneles de proyecto.
- Layouts separados para autenticacion y aplicacion principal.
- Tema sincronizado con `ThemeSync` y utilidades de preferencias.
- Assets propios para logos, fondos, iconos, archivos, tracking y estados vacios.

## 15. Estado funcional actual

- Login y logout.
- Recuperacion, verificacion y restablecimiento de contrasena.
- Cambio de contrasena desde configuraciones.
- Carga de foto de perfil.
- Rutas protegidas por autenticacion.
- Rutas protegidas por rol.
- Dashboard cliente.
- Dashboard arquitecto/admin.
- Creacion/solicitud de nuevo proyecto.
- Busqueda de direccion mediante Geoapify.
- Listado y detalle de proyectos.
- Publicacion/visibilidad de proyectos.
- Comentarios en proyectos.
- Eventos en tiempo real para comentarios via SSE.
- Carga y eliminacion de archivos en solicitudes.
- Lectura/stream de archivos de proyecto.
- Paneles de detalle: informacion, documentos, renders, videos, seguimiento y garantias.
- Configuracion de perfil, preferencias, seguridad y soporte.

## 16. Comandos recomendados

Frontend:

```bash
cd Frontend
pnpm install
pnpm run dev
```

Backend:

```bash
cd Backend
pnpm install
pnpm run dev
```

Build frontend:

```bash
cd Frontend
pnpm run build
```

Lint frontend:

```bash
cd Frontend
pnpm run lint
```

## 17. Pendientes recomendados

- Agregar `.env.example` para frontend y backend.
- Versionar migraciones SQL.
- Documentar tablas y columnas reales desde base de datos.
- Agregar pruebas automaticas para auth, permisos y flujos criticos.
- Documentar despliegue por ambiente.
- Formalizar convenciones de componentes UI y tokens de diseno.
