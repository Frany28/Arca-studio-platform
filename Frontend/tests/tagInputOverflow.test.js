import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("tag inputs keep large employee collections inside a single scrollable row", async () => {
  const inputSource = await readFile(
    new URL("../src/components/ui/Input/Input.jsx", import.meta.url),
    "utf8",
  );
  const groupSource = await readFile(
    new URL("../src/components/ui/Input/tags/InputTagGroup.jsx", import.meta.url),
    "utf8",
  );
  const tagConfigSource = await readFile(
    new URL("../src/components/ui/Tag/tagConfig.js", import.meta.url),
    "utf8",
  );

  assert.match(inputSource, /flex-nowrap overflow-x-auto/);
  assert.match(inputSource, /\[scrollbar-width:none\]/);
  assert.match(inputSource, /\[&::-webkit-scrollbar\]:hidden/);
  assert.match(
    groupSource,
    /"flex h-\[22px\] w-full flex-nowrap items-center gap-\[4px\] overflow-x-auto/,
  );
  assert.match(tagConfigSource, /h-\[22px\]/);
});
