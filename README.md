# ARCA Studio Platform

Plataforma web para la gestión de proyectos de arquitectura e interiorismo de **ARCA Studio**.

El sistema permite centralizar la interacción entre clientes, arquitectos y administradores mediante dashboards personalizados, gestión de proyectos, documentos, renders, videos, seguimiento de obra, comentarios y solicitudes.

> Este repositorio corresponde a la plataforma de gestión de ARCA Studio.  
> La página pública/landing del estudio se mantiene en un proyecto independiente.

## Arquitectura

El proyecto está dividido en dos aplicaciones:

- `Frontend/` — SPA desarrollada con React y Vite.
- `Backend/` — API REST desarrollada con Node.js y Express.

La documentación técnica completa está disponible en [DOCUMENTACION.md](DOCUMENTACION.md).

El [mapeo del frontend](Frontend/docs/FRONTEND_MAP.md) enumera rutas, componentes y consumidores. La [revisión del frontend](Frontend/docs/FRONTEND_REVIEW.md) documenta los cambios y las verificaciones. Se regenera desde `Frontend` con `pnpm audit:frontend`.

## Tecnologías

### Frontend

- React 19
- Vite 8
- Tailwind CSS 4
- React Router 7
- GSAP
- Motion
- Three.js
- Google Model Viewer
- PDF.js
- XLSX

### Backend

- Node.js 22
- Express 5
- PostgreSQL
- Prisma
- Supabase
- Zod
- bcrypt
- Helmet
- CORS

### Servicios externos

- Supabase
- Geoapify
- Resend
- Netlify
- Vercel

## Funcionalidades

- Autenticación y recuperación de contraseña.
- Gestión de sesiones, roles y permisos.
- Dashboard para clientes.
- Dashboard para arquitectos y administradores.
- Creación y solicitud de proyectos.
- Gestión de documentos y archivos.
- Visualización de renders, videos y modelos 3D.
- Seguimiento de proyectos.
- Gestión de garantías.
- Sistema de comentarios en tiempo real mediante SSE.
- Búsqueda de direcciones con Geoapify.
- Gestión de perfil y fotografía de usuario.
- Configuración de preferencias, seguridad y soporte.




cd Frontend
pnpm install
pnpm run dev
