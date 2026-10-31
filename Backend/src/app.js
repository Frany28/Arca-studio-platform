import express from "express";
import cors from "cors";
import helmet from "helmet";
import { corsOptions } from "./config/cors.js";
import { loadSession } from "./middlewares/auth.js";
import { requireTrustedOrigin } from "./middlewares/trustedOrigin.js";
import { requestMetrics } from "./middlewares/requestMetrics.js";
import { sanitizePublicResponse } from "./middlewares/sanitizePublicResponse.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import environmentCommentRoutes from "./routes/environmentComments.js";
import geoapifyRoutes from "./routes/geoapify.js";
import projectRequestRoutes from "./routes/projectRequests.js";
import projectRoutes from "./routes/projects.js";
import routes from "./routes/index.js";
import { measurementUnitDenominationRouter, measurementUnitRouter } from "./routes/measurementUnits.js";
import quoteRoutes from "./routes/quotes.js";
import serviceCatalogRoutes from "./routes/serviceCatalog.js";
import supportRoutes from "./routes/support.js";
import { normalizeError } from "./errors/appError.js";

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors(corsOptions()));
app.use(requestMetrics);
app.use(express.json({ limit: "100kb" }));
app.use(sanitizePublicResponse);
app.use(loadSession);
app.use(requireTrustedOrigin);
app.use("/api/auth", authRoutes);
// Antes de /api/admin: catálogo, unidades y cotizaciones tienen routers propios con autenticación y rol admin.
app.use("/api/admin/services", serviceCatalogRoutes);
app.use("/api/admin/quotes", quoteRoutes);
app.use("/api/admin/measurement-units", measurementUnitRouter);
app.use("/api/admin/measurement-unit-denominations", measurementUnitDenominationRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/environment-comments", environmentCommentRoutes);
app.use("/api/geoapify", geoapifyRoutes);
app.use("/api/project-requests", projectRequestRoutes);
app.use("/api/projects", projectRoutes);
app.use("/api/support", supportRoutes);
app.use("/api", routes);

app.use("/api", (req, res) => {
  res.status(404).json({
    code: "API_ROUTE_NOT_FOUND",
    message: "Ruta de API no encontrada.",
  });
});

app.use((error, _req, res, next) => {
  // Con la respuesta ya empezada no se puede enviar otro estado: Express cierra la conexión.
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);
  console.error("Unhandled request error", {
    code: error.code,
    message: error.message,
    name: error.name,
  });

  // Saturación de la base (P1-2): 503 con Retry-After, igual que el 503 del rate limiter.
  if (normalized.retryAfter) res.setHeader("Retry-After", String(normalized.retryAfter));
  res.status(normalized.status).json({
    code: normalized.code,
    message: normalized.message,
    ...(normalized.fields ? { fields: normalized.fields } : {}),
    ...(normalized.retryAfter ? { retryAfter: normalized.retryAfter } : {}),
  });
});

export default app;
