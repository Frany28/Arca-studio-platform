import { useCallback, useRef, useState } from "react";

export function useProjectDocumentSelection() {
  const [recentDocumentModal, setRecentDocumentModal] = useState(null);

  const recentDocumentTriggerRef = useRef(null);

  const openRecentDocument = useCallback(
    (document, triggerElement) => {
      recentDocumentTriggerRef.current = triggerElement || null;
      setRecentDocumentModal(document);
    },
    [],
  );

  return {
    recentDocumentModal,
    setRecentDocumentModal,
    recentDocumentTriggerRef,
    openRecentDocument,
  };
}
