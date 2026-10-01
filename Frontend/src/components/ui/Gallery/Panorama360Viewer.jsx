import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import Button from "../Button/Button.jsx";
import GeneralCommentsDrawer from "./GeneralCommentsDrawer.jsx";
import { useImageComments } from "./useImageComments.js";
import { useProjectReadOnly } from "../../../contexts/ProjectReadOnlyContext.jsx";

function normalizeAngle(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

function directionToPanoramaPoint(direction) {
  const normalized = direction.clone().normalize();
  return {
    kind: "panorama-point",
    yaw: normalizeAngle(THREE.MathUtils.radToDeg(Math.atan2(normalized.x, -normalized.z))),
    pitch: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(normalized.y, -1, 1))),
  };
}

function pointToDirection({ yaw, pitch }) {
  const yawRadians = THREE.MathUtils.degToRad(yaw);
  const pitchRadians = THREE.MathUtils.degToRad(pitch);
  const cosPitch = Math.cos(pitchRadians);
  return new THREE.Vector3(
    Math.sin(yawRadians) * cosPitch,
    Math.sin(pitchRadians),
    -Math.cos(yawRadians) * cosPitch,
  );
}

export default function Panorama360Viewer({ embedded = false, item, projectId, focusedCommentId = null }) {
  const { readOnly } = useProjectReadOnly();
  const containerRef = useRef(null);
  const stageRef = useRef(null);
  const sceneRef = useRef(null);
  const [loadState, setLoadState] = useState("loading");
  const [pendingSelection, setPendingSelection] = useState(null);
  const [, setViewVersion] = useState(0);
  const { addComment, comments } = useImageComments(item, { commentType: "panorama", projectId });
  const roots = useMemo(() => comments.filter((comment) => !comment.parentCommentId && comment.selection), [comments]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !item?.fileUrl) return undefined;
    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.replaceChildren(renderer.domElement);
    sceneRef.current = { camera, renderer, yaw: 0, pitch: 0 };

    const geometry = new THREE.SphereGeometry(500, 64, 40);
    geometry.scale(-1, 1, 1);
    const texture = new THREE.TextureLoader().load(
      item.fileUrl,
      () => !disposed && setLoadState("loaded"),
      undefined,
      () => !disposed && setLoadState("error"),
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture }));
    scene.add(mesh);

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startYaw = 0;
    let startPitch = 0;
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const updateCamera = () => {
      const state = sceneRef.current;
      const direction = pointToDirection({ yaw: state.yaw, pitch: state.pitch });
      camera.lookAt(direction);
      setViewVersion((value) => value + 1);
    };
    const pointerDown = (event) => {
      dragging = true; moved = false;
      startX = event.clientX; startY = event.clientY;
      startYaw = sceneRef.current.yaw; startPitch = sceneRef.current.pitch;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const pointerMove = (event) => {
      if (!dragging) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      moved ||= Math.abs(dx) + Math.abs(dy) > 4;
      sceneRef.current.yaw = normalizeAngle(startYaw - dx * 0.15);
      sceneRef.current.pitch = THREE.MathUtils.clamp(startPitch + dy * 0.15, -85, 85);
      updateCamera();
    };
    const pointerUp = (event) => {
      dragging = false;
      if (moved || readOnly) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      setPendingSelection(directionToPanoramaPoint(raycaster.ray.direction));
    };
    const wheel = (event) => {
      event.preventDefault();
      camera.fov = THREE.MathUtils.clamp(camera.fov + event.deltaY * 0.03, 35, 90);
      camera.updateProjectionMatrix();
      setViewVersion((value) => value + 1);
    };
    const keyDown = (event) => {
      const delta = event.key === "ArrowLeft" ? -3 : event.key === "ArrowRight" ? 3 : 0;
      const pitchDelta = event.key === "ArrowUp" ? 3 : event.key === "ArrowDown" ? -3 : 0;
      if (!delta && !pitchDelta) return;
      event.preventDefault();
      sceneRef.current.yaw = normalizeAngle(sceneRef.current.yaw + delta);
      sceneRef.current.pitch = THREE.MathUtils.clamp(sceneRef.current.pitch + pitchDelta, -85, 85);
      updateCamera();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointermove", pointerMove);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });
    const stageNode = stageRef.current;
    stageNode?.addEventListener("keydown", keyDown);
    resize(); updateCamera();
    let animationFrame;
    const animate = () => { renderer.render(scene, camera); animationFrame = requestAnimationFrame(animate); };
    animate();
    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      stageNode?.removeEventListener("keydown", keyDown);
      geometry.dispose(); texture.dispose(); mesh.material.dispose(); renderer.dispose();
      sceneRef.current = null;
    };
  }, [item?.fileUrl, readOnly]);

  function pointPosition(selection) {
    const state = sceneRef.current;
    const container = containerRef.current;
    if (!state || !container) return { display: "none" };
    const position = pointToDirection(selection).multiplyScalar(10).project(state.camera);
    if (position.z > 1) return { display: "none" };
    return { left: `${(position.x * 0.5 + 0.5) * 100}%`, top: `${(-position.y * 0.5 + 0.5) * 100}%` };
  }

  const stage = (
      <section ref={stageRef} tabIndex={0} aria-label="Visor panorámico 360" className={`relative min-w-0 flex-1 overflow-hidden rounded-[var(--radius-3)] bg-black focus-visible:ring-2 focus-visible:ring-[var(--color-primary-300)] ${embedded ? "h-full min-h-0" : "min-h-[520px]"}`}>
        <div ref={containerRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />
        {loadState !== "loaded" ? <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-neutral-300)] text-[var(--color-neutral-100-uniform)]">{loadState === "error" ? "No se pudo cargar la panorámica." : "Cargando panorámica 360…"}</div> : null}
        {roots.map((comment) => <button key={comment.id} type="button" style={pointPosition(comment.selection)} className="absolute z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-primary-300)] text-heading-8 text-white shadow-[var(--shadow-e2)]" aria-label={`Observación ${comment.pointNumber}`}>{comment.pointNumber}</button>)}
        {pendingSelection ? <span style={pointPosition(pendingSelection)} className="pointer-events-none absolute z-10 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-[var(--color-primary-300)] text-white">+</span> : null}
        {!embedded ? <div className="absolute right-3 top-3 z-30"><Button size="S" type="Outline" theme="Info" fitContent onClick={() => stageRef.current?.requestFullscreen?.()}>Pantalla completa</Button></div> : null}
      </section>
  );

  if (embedded) return stage;

  return (
    <div className="flex min-h-[520px] w-full gap-[12px] max-[920px]:flex-col">
      {stage}
      <aside className="w-[296px] shrink-0 max-[920px]:h-[360px] max-[920px]:w-full">
        <GeneralCommentsDrawer comments={comments} focusedSelectionCommentId={focusedCommentId} mediaItem={item} mediaType="panorama" pendingSelection={pendingSelection} requireSelectionForRoot onClearSelection={() => setPendingSelection(null)} onSubmitComment={async (payload) => { await addComment(payload); if (!payload.parentCommentId) setPendingSelection(null); }} />
      </aside>
    </div>
  );
}
