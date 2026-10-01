import { readSources } from "./helpers/readSources.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { updateDropdownCheckboxItems } from
  "../src/components/ui/DropdownMenu/dropdownMenuSelection.js";

const items = [
  { id: "one", label: "Uno", checked: "Yes" },
  { id: "two", label: "Dos", checked: "No" },
  { id: "three", label: "Tres", checked: "No" },
];

test("multiple dropdown selection preserves previous checks", () => {
  assert.deepEqual(updateDropdownCheckboxItems(items, "two", true), [
    { id: "one", label: "Uno", checked: "Yes" },
    { id: "two", label: "Dos", checked: "Yes" },
    { id: "three", label: "Tres", checked: "No" },
  ]);
});

test("multiple dropdown selection can uncheck an item", () => {
  assert.deepEqual(updateDropdownCheckboxItems(items, "one", true), [
    { id: "one", label: "Uno", checked: "No" },
    { id: "two", label: "Dos", checked: "No" },
    { id: "three", label: "Tres", checked: "No" },
  ]);
});

test("single dropdown selection remains exclusive", () => {
  assert.deepEqual(updateDropdownCheckboxItems(items, "two", false), [
    { id: "one", label: "Uno", checked: "No" },
    { id: "two", label: "Dos", checked: "Yes" },
    { id: "three", label: "Tres", checked: "No" },
  ]);
});

test("composite checkbox options preserve selection while hovered", async () => {
  const dropdownSource = await readFile(
    new URL(
      "../src/components/ui/DropdownMenu/DropdownMenu.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  const projectRequestSource = await readSources(new URL("../src/pages/ProjectRequestPage.jsx", import.meta.url), new URL("../src/pages/project-request/components/LegalDocumentTypesField.jsx", import.meta.url));

  assert.match(
    dropdownSource,
    /const resolvedChecked = visualState === "Selected" \? "Yes" : checked/,
  );
  assert.doesNotMatch(
    dropdownSource,
    /visualState === "Hover"\s*\?\s*"No"\s*:\s*checked/,
  );
  assert.match(projectRequestSource, /setHoveredDocumentType\(option\.value\)/);
  assert.match(
    projectRequestSource,
    /state=\{hoveredDocumentType === option\.value \? "Hover" : undefined\}/,
  );
});

test("dropdown content starts below the trigger divider and shares its width", async () => {
  const dropdownSource = await readFile(
    new URL(
      "../src/components/ui/DropdownMenu/DropdownMenu.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(dropdownSource, /absolute inset-x-0 top-full/);
  assert.match(dropdownSource, /box-border w-auto/);
  assert.match(dropdownSource, /border-b-\[var\(--color-neutral-400\)\]/);
  assert.doesNotMatch(dropdownSource, /top-\[calc\(100%_-_1px\)\]/);
});
