import { apiRequest } from "./client.js";
import { uploadRawFile } from "./fileUploadClient.js";

export const supportApi = {
  createRequest({ description, issueType, subject }) {
    return apiRequest("/support/requests", {
      body: JSON.stringify({ description, issueType, subject }),
      method: "POST",
    });
  },

  uploadFile({
    file,
    onUploadProgress,
    signal,
    supportRequestId,
  }) {
    return uploadRawFile({
      file,
      onUploadProgress,
      path: `/support/requests/${supportRequestId}/files`,
      signal,
    });
  },
};
