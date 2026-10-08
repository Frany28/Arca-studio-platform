import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("long tag values stay inside their assigned column", async () => {
  const [tagSource, configSource, projectsSource] = await Promise.all([
    readFile(new URL("../src/components/ui/Tag/Tag.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/ui/Tag/tagConfig.js", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(configSource, /inline-flex min-w-0 max-w-full/);
  assert.match(tagSource, /min-w-0 flex-1[\s\S]*overflow-hidden[\s\S]*text-ellipsis/);
  assert.match(projectsSource, /title=\{projectName\}/);
  // El ancho máximo aplica en todos los tamaños; móvil solo cambia la tipografía del Tag.
  assert.match(projectsSource, /className=\{clsx\("w-full max-w-\[107px\]"/);
  assert.doesNotMatch(projectsSource, /max-w-\[107px\][^\n]*max-w-none/);
});
