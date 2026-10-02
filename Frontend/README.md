# Frontend - Sistema Web Arca Studio

SPA construida con React, Vite y Tailwind CSS para la experiencia web de clientes, arquitectos y administradores.

## Stack

- React 19.
- React DOM 19.
- Vite 8.
- Tailwind CSS 4 con `@tailwindcss/vite`.
- React Router DOM 7.
- Iconsax React.
- Three.js para la visualización de panorámicas equirectangulares 360.
- ESLint 9.

## Scripts

```bash
pnpm run dev
pnpm run build
pnpm run lint
pnpm test
pnpm run preview
```

## Estructura principal

```text
src/
  api/          Acceso HTTP por dominio
  assets/       Logos, fondos, iconos e imágenes
  auth/         Sesión, autorización, contextos y guards
  components/   Componentes compartidos de producto
    layout/     Estructuras compartidas de autenticación
    ui/         Design System y visores compartidos
  config/       Configuración estática compartida
  contexts/     Contextos de dominio
  data/         Datos estáticos compartidos
  hooks/        Hooks compartidos entre funcionalidades
  pages/        Páginas y módulos por feature
  styles/       Tokens globales y tipografía
  utils/        Funciones puras y utilidades compartidas
```

`main.jsx` declara las rutas y carga las páginas mediante `lazy()`. `index.html`
carga también `theme-init.js` para inicializar el tema. No existe un barrel global
de páginas. Las entradas `ProjectDetails.jsx` y `Settings.jsx` mantienen rutas de
importación estables hacia sus implementaciones por feature.

Las features `home`, `project-request`, `projects`, `admin-users`, `admin-files`,
`architect-dashboard` y `settings` agrupan su código específico. Usan `components/`,
`hooks/`, `panels/` y `utils/` cuando lo necesitan; los datos y configuraciones
locales permanecen junto a la feature. No es obligatorio crear todas las carpetas.
Las páginas de autenticación y ejemplos de estados vacíos siguen en `pages/`.

En `api/`, `client.js` mantiene la infraestructura HTTP compartida y `http.js`
es la fachada compatible (`api`, reexports de dominios y `getApiUrl`). Los módulos
`authApi.js`, `adminApi.js`, `projectsApi.js`, `projectRequestsApi.js`,
`environmentCommentsApi.js` y `supportApi.js` separan el acceso por dominio.
`adminDashboardOverview.js` adapta los datos del dashboard administrativo.

Los archivos raíz de `components/ui`, como `Avatar.jsx` o `Accordion.jsx`, pueden
ser reexports públicos de la implementación en su subcarpeta. No representan
componentes duplicados. Configuración y catálogos `*ShowcaseData.js` permanecen
junto al componente. Antes de añadir interfaz, consultar [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

El [informe de auditoría estructural](STRUCTURE_AUDIT.md) contiene el inventario,
las comprobaciones de referencias y las decisiones de conservación y eliminación.

## Rutas principales

- `/`: login, solo para usuarios sin sesion.
- `/cuenta-inactiva`: aviso de cuenta inactiva.
- `/recuperar-cuenta`: solicitud de recuperacion.
- `/nueva-contraseña`: nueva contrasena.
- `/dashboard-clientes`: dashboard de cliente.
- `/dashboard-clientes-vacio`: estado vacio de dashboard de cliente.
- `/dashboard-arquitecto`: dashboard de arquitecto/admin.
- `/dashboard-arquitecto/nuevo-proyecto`: flujo de nuevo proyecto.
- `/dashboard-arquitecto-vacio`: estado vacio de dashboard de arquitecto.
- `/proyectos/:projectId`: detalle de proyecto.
- `/configuraciones`: perfil, preferencias, seguridad y soporte.

Nota: el codigo actual mantiene la ruta con `nueva-contraseña`. Si se normalizan URLs ASCII, actualizar tambien enlaces internos y flujos de recuperacion.

## Variables de entorno

- `VITE_API_URL`: URL base opcional de la API solo para desarrollo. Si no se
  define, Vite envia `/api` al backend local mediante su proxy. En produccion
  siempre se usa `/api` para mantener la cookie de sesion en el mismo sitio.
- `DEPLOY_BASE_PATH`: base path usada por Vite cuando aplica.

## Desarrollo local

```bash
pnpm install
pnpm run dev
```

La aplicacion queda disponible normalmente en `http://localhost:5173`.
