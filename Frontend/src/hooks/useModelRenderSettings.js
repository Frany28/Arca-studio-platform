import { useCallback, useEffect, useState } from "react";

import { DEFAULT_ARCHITECTURAL_SETTINGS } from "../utils/architecturalRendering.js";

export default function useModelRenderSettings({ fileId, projectId }) {
  const [settings, setSettings] = useState(DEFAULT_ARCHITECTURAL_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      setSettings(DEFAULT_ARCHITECTURAL_SETTINGS);
      setIsLoading(false);

      if (fileId && projectId) {
        setError("");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [fileId, projectId]);

  const save = useCallback(
    async (nextSettings) => {
      if (!fileId || !projectId || !settings.canEdit) return settings;
      setIsSaving(true);
      setError("");
      setSettings(nextSettings);
      setIsSaving(false);
      return nextSettings;
    },
    [fileId, projectId, settings],
  );

  return { error, isLoading, isSaving, save, settings, setSettings };
}
