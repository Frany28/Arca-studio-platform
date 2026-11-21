import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  acquireBodyScrollLock,
  releaseBodyScrollLock,
} from "../src/hooks/useBodyScrollLock.js";

// Cada visor se compone de su modal y del escenario compartido con Gestión de archivos
// (ImageViewerStage, VideoViewerStage): la composición se comprueba sobre ambos.
const readGallerySource = (...names) => names
  .map((name) => readFileSync(new URL(`../src/components/ui/Gallery/${name}`, import.meta.url), "utf8"))
  .join("\n");
const imageViewerSource = readGallerySource("ImageViewerModal.jsx", "ImageViewerStage.jsx");
const videoViewerSource = readGallerySource("VideoViewerModal.jsx", "VideoViewerStage.jsx");
const galleryVideosSource = readFileSync(
  new URL(
    "../src/components/ui/Gallery/GalleryVideosModal.jsx",
    import.meta.url,
  ),
  "utf8",
);
const bodyScrollLockSource = readFileSync(
  new URL("../src/hooks/useBodyScrollLock.js", import.meta.url),
  "utf8",
);

test("video viewer keeps the image viewer modal composition", () => {
  const sharedLayoutFragments = [
    "fixed inset-0 z-[60] overflow-hidden",
    "bg-[rgba(0,0,0,0.42)] backdrop-blur-[10px] transition-opacity",
    "flex h-dvh w-dvw gap-[16px] p-[16px]",
    "translate-y-[12px] scale-[0.985] opacity-0",
    "rounded-[var(--radius-3)]",
    "max-[920px]:h-[62dvh] max-[920px]:min-h-[360px]",
    "max-[520px]:h-[58dvh] max-[520px]:min-h-[300px]",
    "absolute right-[8px] top-[8px]",
  ];

  sharedLayoutFragments.forEach((fragment) => {
    assert.match(imageViewerSource, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(videoViewerSource, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});

test("video viewer preserves vertical media without cropping", () => {
  assert.match(videoViewerSource, /bg-\[var\(--color-neutral-950-uniform\)\]/);
  assert.match(videoViewerSource, /cursor-pointer object-contain/);
  assert.doesNotMatch(videoViewerSource, /cursor-pointer object-cover/);
  assert.match(videoViewerSource, /<PlaybackBar/);
  assert.match(videoViewerSource, /handleFullscreen/);
  assert.match(videoViewerSource, /handleTogglePlay/);
});

test("closing the video releases its overlay and nested body scroll lock", () => {
  assert.match(
    videoViewerSource,
    /visible \? "pointer-events-auto" : "pointer-events-none"/,
  );
  assert.match(videoViewerSource, /useBodyScrollLock\(visible\)/);
  assert.match(galleryVideosSource, /useBodyScrollLock\(visible\)/);
  assert.doesNotMatch(
    galleryVideosSource,
    /document\.body\.style\.overflow\s*=\s*"hidden"/,
  );
  assert.match(bodyScrollLockSource, /activeLocks \+= 1/);
  assert.match(bodyScrollLockSource, /activeLocks = Math\.max\(activeLocks - 1, 0\)/);
  assert.match(
    bodyScrollLockSource,
    /document\.body\.style\.overflow = previousBodyOverflow/,
  );
});

test("nested video modals restore scrolling only after the final close", () => {
  const previousDocument = globalThis.document;
  globalThis.document = { body: { style: { overflow: "auto" } } };

  try {
    acquireBodyScrollLock();
    acquireBodyScrollLock();
    assert.equal(document.body.style.overflow, "hidden");

    releaseBodyScrollLock();
    assert.equal(
      document.body.style.overflow,
      "hidden",
      "The underlying gallery remains locked while its modal is open",
    );

    releaseBodyScrollLock();
    assert.equal(
      document.body.style.overflow,
      "auto",
      "The page recovers its original scroll after the last modal closes",
    );
  } finally {
    globalThis.document = previousDocument;
  }
});
