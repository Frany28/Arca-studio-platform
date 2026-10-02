import { apiRequest, getApiUrl } from "./client.js";

export const authApi = {
  /**
   * Solicita el inicio del registro con los datos recibidos.
   *
   * @param {Object} payload - Datos de registro enviados sin transformaci?n.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  startRegistration(payload) {
    return apiRequest("/auth/registration/start", {
      body: JSON.stringify(payload),
      method: "POST",
    });
  },

  /**
   * Solicita un nuevo correo de verificaci?n del registro.
   *
   * @param {Object} params - Datos del destinatario.
   * @param {string} params.email - Correo del registro.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  resendRegistration({ email }) {
    return apiRequest("/auth/registration/resend", {
      body: JSON.stringify({ email }),
      method: "POST",
    });
  },

  /**
   * Consulta la validez del token antes de completar el registro.
   *
   * @param {Object} params - Datos de verificaci?n.
   * @param {string} params.token - Token recibido por correo.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  verifyRegistration({ token }) {
    return apiRequest("/auth/registration/verify", {
      body: JSON.stringify({ token }),
      method: "POST",
    });
  },

  /**
   * Env?a los datos finales del registro al backend.
   *
   * @param {Object} payload - Datos finales enviados sin transformaci?n.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  completeRegistration(payload) {
    return apiRequest("/auth/registration/complete", {
      body: JSON.stringify(payload),
      method: "POST",
    });
  },

  /**
   * Solicita el inicio de sesi?n; confirmar la sesi?n corresponde al flujo de auth.
   *
   * @param {Object} params - Credenciales introducidas.
   * @param {string} params.email - Correo de acceso.
   * @param {string} params.password - Contrase?a de acceso.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  login({ email, password }) {
    return apiRequest("/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    });
  },

  /**
   * Solicita el correo de recuperaci?n de contrase?a.
   *
   * @param {Object} params - Datos del destinatario.
   * @param {string} params.email - Correo de la cuenta.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  requestPasswordReset({ email }) {
    return apiRequest("/auth/forgot-password", {
      body: JSON.stringify({ email }),
      method: "POST",
    });
  },

  /**
   * Consulta si el token permite continuar la recuperaci?n.
   *
   * @param {Object} params - Datos de recuperaci?n.
   * @param {string} params.token - Token de recuperaci?n.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  verifyResetToken({ token }) {
    return apiRequest("/auth/verify-reset-token", {
      body: JSON.stringify({ token }),
      method: "POST",
    });
  },

  /**
   * Env?a la nueva contrase?a junto con el token de recuperaci?n.
   *
   * @param {Object} params - Datos para recuperar el acceso.
   * @param {string} params.token - Token de recuperaci?n.
   * @param {string} params.password - Nueva contrase?a.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  resetPassword({ token, password }) {
    return apiRequest("/auth/reset-password", {
      body: JSON.stringify({ token, password }),
      method: "POST",
    });
  },

  /**
   * Solicita el cambio de contrase?a de la sesi?n actual.
   *
   * @param {Object} params - Contrase?as para validar el cambio.
   * @param {string} params.currentPassword - Contrase?a actual.
   * @param {string} params.newPassword - Contrase?a propuesta.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  changePassword({ currentPassword, newPassword }) {
    return apiRequest("/auth/change-password", {
      body: JSON.stringify({ currentPassword, newPassword }),
      method: "POST",
    });
  },

  /**
   * Sube el avatar con cookies, progreso y cancelaci?n.
   * Rechaza se?ales ya abortadas y confirma el 100% solo tras el ?xito HTTP.
   *
   * @param {Object} params - Archivo y opciones de subida.
   * @param {Object} params.file - Archivo del avatar.
   * @param {Function} [params.onUploadProgress] - Recibe loaded, total y progress.
   * @param {Object} [params.signal] - AbortSignal de cancelaci?n.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  uploadProfilePhoto({ file, onUploadProgress, signal }) {
    const fileName = encodeURIComponent(file?.name || "avatar");

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const error = new Error("La subida del avatar fue cancelada.");
        error.code = "UPLOAD_ABORTED";
        reject(error);
        return;
      }

      const request = new XMLHttpRequest();
      const abortUpload = () => {
        request.abort();
      };

      request.open("POST", getApiUrl("/auth/profile-photo"));
      request.withCredentials = true;
      request.setRequestHeader(
        "Content-Type",
        file?.type || "application/octet-stream",
      );
      request.setRequestHeader("X-File-Name", fileName);

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable || !event.total) {
          return;
        }

        const progress = Math.min(
          Math.round((event.loaded / event.total) * 100),
          99,
        );

        onUploadProgress?.({
          loaded: event.loaded,
          progress,
          total: event.total,
        });
      };

      request.onload = () => {
        signal?.removeEventListener("abort", abortUpload);
        let data = null;

        try {
          data = request.responseText ? JSON.parse(request.responseText) : null;
        } catch {
          data = null;
        }

        if (request.status < 200 || request.status >= 300) {
          const error = new Error(
            data?.message || "No se pudo actualizar el avatar.",
          );
          error.status = request.status;
          error.code = data?.code || "PROFILE_PHOTO_UPLOAD_FAILED";
          reject(error);
          return;
        }

        onUploadProgress?.({
          loaded: file?.size || 0,
          progress: 100,
          total: file?.size || 0,
        });
        resolve(data);
      };

      request.onerror = () => {
        signal?.removeEventListener("abort", abortUpload);
        reject(new Error("No se pudo actualizar el avatar."));
      };

      request.onabort = () => {
        signal?.removeEventListener("abort", abortUpload);
        const error = new Error("La subida del avatar fue cancelada.");
        error.code = "UPLOAD_ABORTED";
        reject(error);
      };

      signal?.addEventListener("abort", abortUpload, { once: true });
      request.send(file);
    });
  },

  /**
   * Solicita al backend el cierre de sesi?n por cookie.
   *
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  logout() {
    return apiRequest("/auth/logout", {
      method: "POST",
    });
  },

  /**
   * Consulta el usuario de la sesi?n por cookie, sin guardar la respuesta en cach?.
   *
   * @param {Object} [params={}] - Opciones de consulta.
   * @param {Object} [params.signal] - AbortSignal de cancelaci?n.
   * @returns {Promise<Object|null>} Respuesta JSON del backend o null.
   */
  me({ signal } = {}) {
    return apiRequest("/auth/me", { signal });
  },
};
