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
pnpm run preview
```

## Estructura principal

```text
src/
  api/          Cliente HTTP centralizado
  assets/       Logos, fondos, iconos e imagenes
  auth/         Contexto y guards de autenticacion
  components/   Componentes reutilizables
  hooks/        Hooks de dominio
  layouts/      Layouts base
  pages/        Vistas principales
  styles/       Estilos globales y tipografia
  utils/        Utilidades de rutas y Geoapify
```

La distribución interna de API, dashboards, solicitudes, detalle de proyectos y
comentarios se describe en [FRONTEND_REFACTOR.md](docs/FRONTEND_REFACTOR.md).
El inventario completo de módulos y consumidores está en
[FRONTEND_MAP.md](docs/FRONTEND_MAP.md), generado con `pnpm audit:frontend`.

`api/http.js`, `pages/Home.jsx` y `hooks/useProjectComments.js` conservan sus
exportaciones públicas como fachadas de compatibilidad. Las páginas componen
componentes de su flujo y delegan consultas, eventos y estado local a hooks;
las transformaciones puras viven en `utils`. El estado global continúa en los
contextos existentes, sin bibliotecas nuevas.

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
