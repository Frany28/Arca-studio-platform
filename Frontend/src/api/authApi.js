import { apiRequest, getApiUrl } from "./client.js";

export const authApi = {
  startRegistration(payload) {
    return apiRequest("/auth/registration/start", {
      body: JSON.stringify(payload),
      method: "POST",
    });
  },

  resendRegistration({ email }) {
    return apiRequest("/auth/registration/resend", {
      body: JSON.stringify({ email }),
      method: "POST",
    });
  },

  verifyRegistration({ token }) {
    return apiRequest("/auth/registration/verify", {
      body: JSON.stringify({ token }),
      method: "POST",
    });
  },

  completeRegistration(payload) {
    return apiRequest("/auth/registration/complete", {
      body: JSON.stringify(payload),
      method: "POST",
    });
  },

  login({ email, password }) {
    return apiRequest("/auth/login", {
      body: JSON.stringify({ email, password }),
      method: "POST",
    });
  },

  requestPasswordReset({ email }) {
    return apiRequest("/auth/forgot-password", {
      body: JSON.stringify({ email }),
      method: "POST",
    });
  },

  verifyResetToken({ token }) {
    return apiRequest("/auth/verify-reset-token", {
      body: JSON.stringify({ token }),
      method: "POST",
    });
  },

  resetPassword({ token, password }) {
    return apiRequest("/auth/reset-password", {
      body: JSON.stringify({ token, password }),
      method: "POST",
    });
  },

  changePassword({ currentPassword, newPassword }) {
    return apiRequest("/auth/change-password", {
      body: JSON.stringify({ currentPassword, newPassword }),
      method: "POST",
    });
  },

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

  logout() {
    return apiRequest("/auth/logout", {
      method: "POST",
    });
  },

  me({ signal } = {}) {
    return apiRequest("/auth/me", { signal });
  },
};
