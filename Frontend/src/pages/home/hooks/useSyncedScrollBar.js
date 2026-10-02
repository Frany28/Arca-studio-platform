import { useCallback, useEffect, useRef, useState } from "react";

export default function useSyncedScrollBar(contentKey) {
  const containerRef = useRef(null);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(1);

  const syncMetrics = useCallback(() => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const maxScroll = Math.max(
      container.scrollHeight - container.clientHeight,
      0,
    );
    setLength(
      Math.min(
        container.clientHeight / Math.max(container.scrollHeight, 1),
        1,
      ),
    );
    setPosition(maxScroll > 0 ? container.scrollTop / maxScroll : 0);
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(syncMetrics);
    const resizeObserver = new ResizeObserver(syncMetrics);
    resizeObserver.observe(container);
    window.addEventListener("resize", syncMetrics);

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncMetrics);
    };
  }, [contentKey, syncMetrics]);

  const changePosition = useCallback((nextPosition) => {
    const container = containerRef.current;

    if (!container) {
      return;
    }

    const maxScroll = Math.max(
      container.scrollHeight - container.clientHeight,
      0,
    );
    container.scrollTo({ top: maxScroll * nextPosition, behavior: "auto" });
    setPosition(nextPosition);
  }, []);

  return {
    containerRef,
    length,
    onScroll: syncMetrics,
    position,
    setPosition: changePosition,
  };
}
