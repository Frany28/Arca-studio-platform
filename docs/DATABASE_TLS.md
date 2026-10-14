# TLS entre el backend y PostgreSQL (hallazgo D-3)

## Diagnóstico (14 de octubre de 2026)

- **Comportamiento anterior** (`Backend/src/config/db.js`): TLS activa, pero `rejectUnauthorized: false` salvo que existiera `DATABASE_SSL_CA_CERT`. Sin CA, el backend aceptaba cualquier certificado, lo que permitía suplantar la base desde la red (MITM) y capturar las credenciales de `postgres`.
- **Certificados de Supabase:** el pooler (`<región>.pooler.supabase.com`) presenta la cadena `*.pooler.supabase.com` → `Supabase Intermediate 2021 CA` → `Supabase Root 2021 CA`. Esa raíz es **privada** y no está en los almacenes públicos. Con verificación activa y sin CA, la conexión falla con `SELF_SIGNED_CERT_IN_CHAIN` (comprobado). Verificar correctamente exige configurar la CA del proyecto.
- **La URL anulaba la configuración:** `pg` 8.21 aplica los parámetros de la cadena de conexión por encima de la opción `ssl`:
  - `sslmode=disable` o `ssl=0` desactivaban TLS;
  - `sslmode=no-verify`, o `uselibpqcompat=true` con `require`/`prefer`, desactivaban la verificación;
  - incluso `sslmode=require` sustituía el objeto `ssl` y descartaba la CA configurada.
- **Hosts IP:** `pg` solo envía `servername` para nombres DNS. Con una IP, Node comprobaba el certificado contra `localhost`.

## Política actual (`Backend/src/config/databaseTls.js`)

1. **La URL no decide la TLS.** Sus parámetros TLS (`ssl`, `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `sslcrl`, `sslpassword`, `sslnegotiation`, `uselibpqcompat`) se eliminan antes de crear el pool y se registra un aviso. La TLS se define solo con `DATABASE_SSL`, `DATABASE_SSL_REJECT_UNAUTHORIZED` y `DATABASE_SSL_CA_CERT`. Si la URL no tiene parámetros TLS se entrega a `pg` sin modificar.
2. **Entorno desplegado** (cualquier proceso que no sea desarrollo o pruebas local, según `config/environment.js`):
   - TLS obligatoria, salvo con una base en loopback;
   - verificación del certificado y del nombre del host siempre activa;
   - con un host de Supabase (`*.supabase.com`, `*.supabase.co`), `DATABASE_SSL_CA_CERT` es obligatorio; en otros hosts se usa el almacén del sistema si no hay CA;
   - impiden arrancar: `DATABASE_SSL_REJECT_UNAUTHORIZED=false`, una CA que no sea PEM válido y los parámetros de URL que debilitan la TLS (`sslmode` distinto de `require`/`verify-ca`/`verify-full`, `ssl` falso, `uselibpqcompat`, rutas de certificados).
   - La guardia de arranque (`environmentGuard.js`) informa estos casos con códigos y nombres de variable, sin valores. `db.js` vuelve a comprobarlo antes de crear el pool, también en los scripts.
3. **Desarrollo y pruebas locales:**
   - loopback sin TLS (salvo `DATABASE_SSL=true`);
   - con una base remota, se verifica si hay CA o si se pide `DATABASE_SSL_REJECT_UNAUTHORIZED=true`;
   - en otro caso se conecta sin verificar y se avisa por consola (`database_tls_warning`), nunca en silencio.
4. **Hosts IP:** se pasa la IP como identidad esperada para que la verificación la compruebe.

## Configuración para Supabase y Vercel

1. En Supabase: **Project Settings → Database → SSL Configuration → Download certificate**. Obtener el archivo desde el panel, nunca desde la cadena que presenta el servidor.
2. Validarlo en local antes de tocar Vercel:
   - copiar el contenido PEM en `DATABASE_SSL_CA_CERT` del `.env` local (líneas reales o con `\n`);
   - ejecutar `pnpm check:db-tls`. Debe responder `"tls":true`, `"certificateTrusted":true` y `"verification":"verificada con DATABASE_SSL_CA_CERT"`.
3. En Vercel (proyecto del backend, entornos Production y Preview):
   - añadir `DATABASE_SSL_CA_CERT` con el PEM;
   - eliminar `DATABASE_SSL_REJECT_UNAUTHORIZED` si existe, o dejarlo en `true`;
   - comprobar que `DATABASE_SSL` no es `false`;
   - comprobar que `DATABASE_URL` no incluye `sslmode=no-verify`, `ssl=0`, `uselibpqcompat` ni `sslrootcert`.
4. **Hacerlo antes de desplegar el backend nuevo.** Sin la CA, la función no se inicializa (`DATABASE_SSL_CA_REQUIRED`) y el log indica la variable que falta.

## Pruebas

`Backend/tests/databaseTls.test.js`:

- matriz de configuraciones desplegadas válidas e inválidas;
- comportamiento local;
- URL con parámetros TLS;
- hosts IP;
- mensajes sin secretos;
- integración con la guardia de arranque;
- handshakes reales con `pg` contra un servidor PostgreSQL simulado, con certificados efímeros generados con `openssl` en un directorio temporal (se omiten si no hay `openssl`):
  - CA de confianza: conecta;
  - sin CA o con una CA ajena: se rechaza;
  - host que no coincide con el certificado: se rechaza;
  - `sslmode=require` en la URL: la CA configurada se conserva (antes se perdía);
  - `sslmode=no-verify` en la URL: no desactiva la verificación.

## Límites y riesgos pendientes

- **Prisma CLI (migraciones)** no usa este módulo: conecta con su propio motor usando `DIRECT_URL` (o `DATABASE_URL`). Su TLS se configura con parámetros de esa URL, y la verificación del certificado depende de la versión de Prisma. Antes de ejecutar migraciones remotas, configurar `DIRECT_URL` con la CA de Supabase según la documentación de Prisma 7 y comprobarlo. Esos parámetros pertenecen a `DIRECT_URL`, no a `DATABASE_URL`: en un despliegue, `DATABASE_URL` con `sslrootcert` impide arrancar.
- La CA de Supabase puede rotarse. Si cambia, la conexión fallará con un error de verificación: actualizar `DATABASE_SSL_CA_CERT` con el certificado nuevo del panel, nunca desactivar la verificación.
- En local, sin CA, la conexión remota sigue sin verificarse (con aviso). Se recomienda configurar también la CA en el `.env` local.
- Los certificados de cliente (mTLS) no se admiten por URL. Si se necesitaran, habría que añadirlos a la política de `databaseTls.js`.
