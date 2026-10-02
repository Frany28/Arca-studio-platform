import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tag input exposes accessible state, keyboard behavior and Figma hint rules", async () => {
  const inputSource = await readFile(
    new URL("../src/components/ui/Input/Input.jsx", import.meta.url),
    "utf8",
  );

  const [hookSource, groupSource] = await Promise.all([
    readFile(new URL("../src/components/ui/Input/tags/useInputTags.js", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/Input/tags/InputTagGroup.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(inputSource, /tags = \[\]/);
  assert.match(
    inputSource,
    /showHint && !\(resolvedType === "Tags" && resolvedState === "Focused"\)/,
  );
  assert.match(inputSource, /aria-describedby=\{resolvedAriaDescribedBy\}/);
  assert.match(inputSource, /aria-invalid=\{resolvedAriaInvalid\}/);
  assert.match(inputSource, /onKeyDown=\{handleInputKeyDown\}/);
  assert.match(hookSource, /currentLabel === nextLabel/);
  assert.match(groupSource, /avatarSrc=\{tag\.avatarSrc \?\? ""\}/);
  assert.match(groupSource, /handleTagOptionSelection/);
  assert.match(groupSource, /closeIcon=\{false\}/);
  assert.match(inputSource, /baseState === "Default" && isFocused/);
  assert.match(inputSource, /showSelectedTagsBelow/);
  assert.match(inputSource, /maxVisibleTagOptions = 3/);
  assert.match(hookSource, /visibleSelectableTags = filteredSelectableTags\.slice/);
  assert.match(hookSource, /normalizeTagSearchText/);
  assert.match(groupSource, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(hookSource, /requestAnimationFrame\(\(\) => resolvedInputRef\.current\?\.focus\(\)\)/);
  assert.match(hookSource, /tagFieldScrollRef\.current\?\.scrollTo\(\{ left: 0 \}\)/);
});

test("tag avatars support real images with fallback initials", async () => {
  const [tagSource, avatarSource, avatarConfigSource] = await Promise.all([
    readFile(new URL("../src/components/ui/Tag/Tag.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/Avatar/Avatar.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/Avatar/avatarConfig.js", import.meta.url), "utf8"),
  ]);

  assert.match(tagSource, /avatarSrc = ""/);
  assert.match(tagSource, /size="XS"/);
  assert.match(tagSource, /theme=\{avatarTheme\}/);
  assert.match(tagSource, /content=\{avatarContent\}/);
  assert.match(avatarSource, /failedImageSrc !== src/);
  assert.match(avatarConfigSource, /size-\[16px\]/);
  assert.match(tagSource, /aria-label=\{`Quitar \$\{label\}`\}/);
  assert.match(tagSource, /text-\[var\(--color-text-200\)\]/);
});
