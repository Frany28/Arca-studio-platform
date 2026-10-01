import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gallerySource = readFileSync(
  new URL(
    "../src/pages/publicSite/featuredProjects/components/FeaturedProjectsGallery.jsx",
    import.meta.url,
  ),
  "utf8",
);
const processGridSource = readFileSync(
  new URL(
    "../src/pages/publicSite/processes/components/ProcessesVideoGrid.jsx",
    import.meta.url,
  ),
  "utf8",
);
const processModalSource = readFileSync(
  new URL(
    "../src/pages/publicSite/processes/components/ProcessesVideoModal.jsx",
    import.meta.url,
  ),
  "utf8",
);

test("image galleries keep their bento layout but are no longer interactive viewers", () => {
  assert.match(gallerySource, /columns\.map\(\(cards, column\)/);
  assert.match(gallerySource, /grid-rows-\[568fr_336fr\]/);
  assert.match(gallerySource, /grid-rows-\[335fr_569fr\]/);
  assert.match(gallerySource, /PRIMARY_CARD_ID = "1-1"/);
  assert.match(gallerySource, /data-featured-image-gallery/);
  assert.doesNotMatch(gallerySource, /<button/);
  assert.doesNotMatch(gallerySource, /onClick=/);
  assert.doesNotMatch(gallerySource, /activeImage|selectedImage|isClosing/);
  assert.doesNotMatch(gallerySource, /role="dialog"|aria-modal/);
});

test("the bento scrubs through a reversible GSAP Flip layout", () => {
  assert.match(gallerySource, /import \{ Flip \} from "gsap\/Flip"/);
  assert.match(gallerySource, /gsap\.registerPlugin\(ExpoScaleEase, Flip\)/);
  assert.match(gallerySource, /sourceGrid\.getBoundingClientRect\(\)/);
  assert.match(gallerySource, /window\.innerWidth/);
  assert.match(gallerySource, /window\.innerHeight/);
  assert.match(gallerySource, /expansionProgress\.on\("change"/);
  assert.match(gallerySource, /Flip\.getState\(/);
  assert.match(gallerySource, /Flip\.to\(finalState/);
  assert.match(gallerySource, /ease: reduceMotion \? "none" : "expoScale\(1, 5\)"/);
  assert.match(gallerySource, /flipTimelineRef\.current\?\.progress\(progress, false\)/);
  assert.match(gallerySource, /const stageRect = stage\.getBoundingClientRect\(\)/);
  assert.match(gallerySource, /\{stage\}/);
  assert.match(gallerySource, /object-fit|fit = "cover"/);
  assert.match(gallerySource, /ResizeObserver/);
  assert.match(gallerySource, /orientationchange/);
  assert.doesNotMatch(gallerySource, /ScrollTrigger/);
  assert.doesNotMatch(gallerySource, /interpolate\(/);
});

test("the stage hands off only after matching the source Bento geometry", () => {
  assert.match(
    gallerySource,
    /mx-auto grid h-full w-full max-w-\[1441px\][\s\S]*px-\[24px\] py-\[48px\]/,
  );
  assert.match(gallerySource, /padding: 0/);
  assert.match(
    gallerySource,
    /hideOriginalCards\(\);\s*stage\.style\.visibility = "visible"/,
  );
});

test("a Flip timeline persists through progress reversals", () => {
  assert.match(
    gallerySource,
    /const needsFreshLayout = !flipTimelineRef\.current/,
  );
  assert.match(gallerySource, /const preparedStageTop = stageRect\.top/);
  assert.match(gallerySource, /preparationOffset\?\.get\?\.\(\) \?\? 0/);
  assert.doesNotMatch(gallerySource, /previousProgress >= 1/);
  assert.doesNotMatch(gallerySource, /if \(progress <= 0\) clearFlipTimeline/);
  assert.doesNotMatch(gallerySource, /createPortal/);
});

test("cancelling a prepared navbar entry invalidates only its stale Flip geometry", () => {
  assert.match(gallerySource, /preparationOffset\.on\("change"/);
  assert.match(
    gallerySource,
    /if \(\(expansionProgress\?\.get\?\.\(\) \?\? 0\) <= 0\) \{\s*clearFlipTimeline\(\);/,
  );
  assert.doesNotMatch(gallerySource, /if \(progress <= 0\) clearFlipTimeline/);
});

test("the expanded layout is a single larger Bento grid, not scattered cards", () => {
  assert.match(gallerySource, /data-featured-gallery-stage-grid/);
  assert.match(gallerySource, /gridTemplateColumns: `repeat\(3, \$\{viewportWidth\}px\)`/);
  assert.match(gallerySource, /gridTemplateRows: column === 1/);
  assert.match(gallerySource, /height: viewportHeight \* 1\.5 \+ gap/);
  assert.match(gallerySource, /left: -\(viewportWidth \+ gap\) - stageRect\.left/);
  assert.match(gallerySource, /top: -\(viewportHeight \* 0\.5 \+ gap\) - preparedStageTop/);
  assert.doesNotMatch(gallerySource, /getSecondaryFinalPosition/);
  assert.doesNotMatch(gallerySource, /rect\.width - gutter/);
  assert.doesNotMatch(gallerySource, /viewportWidth \+ gutter/);
  assert.match(gallerySource, /pointer-events-none absolute inset-0 z-10 overflow-hidden/);
  assert.match(gallerySource, /aria-hidden="true"/);
  assert.doesNotMatch(gallerySource, /card\.style\.opacity/);
  assert.doesNotMatch(gallerySource, /createPortal/);
});

test("process videos retain their click and modal behavior", () => {
  assert.match(processGridSource, /<Button layout="content"/);
  assert.match(processGridSource, /onClick=\{\(event\) =>/);
  assert.match(processGridSource, /onVideoOpen\(video/);
  assert.match(processModalSource, /createPortal\(/);
  assert.match(processModalSource, /onClick=\{handleClose\}/);
  assert.match(processModalSource, /autoPlay/);
  assert.match(processModalSource, /<source src=\{video\.webm\}/);
  assert.match(processModalSource, /<source src=\{video\.mp4\}/);
});
