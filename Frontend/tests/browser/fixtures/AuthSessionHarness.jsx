import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { apiRequest } from "../../../src/api/client.js";
import { AuthProvider } from "../../../src/auth/AuthContext.jsx";
import ProtectedRoute from "../../../src/auth/ProtectedRoute.jsx";

/**
 * Vista privada mínima que lanza peticiones reales de apiRequest y muestra su resultado.
 * Permite comprobar desde Playwright cómo reacciona la sesión global ante 401 y 403.
 *
 * @returns {JSX.Element} Botones de petición y resultado visible.
 */
function PrivatePage() {
  const [result, setResult] = useState("sin petición");

  /**
   * Ejecuta una petición autenticada y publica el código obtenido.
   *
   * @param {string} path - Ruta de API solicitada.
   * @returns {Promise<void>} Finaliza al mostrar el resultado.
   */
  async function run(path) {
    try {
      await apiRequest(path);
      setResult("ok");
    } catch (error) {
      setResult(error.code || "error");
    }
  }

  return (
    <main id="private-page">
      <button type="button" onClick={() => run("/projects")}>Cargar proyectos</button>
      <button type="button" onClick={() => run("/admin/users")}>Acción administrativa</button>
      <output id="request-result">{result}</output>
    </main>
  );
}

/**
 * Monta AuthProvider y ProtectedRoute reales sobre un router en memoria que empieza en la vista privada.
 *
 * @returns {JSX.Element} Aplicación de prueba.
 */
export default function AuthSessionHarness() {
  return (
    <MemoryRouter initialEntries={["/private"]}>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<p id="login-page">Iniciar sesión</p>} />
          <Route element={<ProtectedRoute />}>
            <Route path="/private" element={<PrivatePage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

createRoot(document.getElementById("root")).render(<AuthSessionHarness />);
