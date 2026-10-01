import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { formatFileUploadDate, formatStorage } from "../src/utils/fileMetrics.js";

test("admin files page implements the Figma KPI section with live metrics", async () => {
  const [page, kpi, http] = await Promise.all([
    readFile(new URL("../src/pages/admin-files/AdminFilesPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AdminKpiMetric.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/adminApi.js", import.meta.url), "utf8"),
  ]);

  const labels = ["Archivos totales", "Espacio Usado", "Última carga"];
  const positions = labels.map((label) => page.indexOf(`label="${label}"`));
  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual(positions, [...positions].sort((first, second) => first - second));
  assert.match(page, /<DocumentText size="24" variant="Linear"/);
  assert.match(page, /<CloudConnection size="24" variant="Linear"/);
  assert.match(page, /<DocumentUpload size="24" variant="Linear"/);
  assert.match(page, /iconType="Accent"/);
  assert.match(page, /iconType="Info"/);
  assert.match(page, /iconType="Warning"/);
  assert.match(page, /border-y border-\[var\(--color-neutral-200\)\] py-\[24px\]/);
  assert.match(kpi, /w-\[235px\][\s\S]*gap-\[12px\][\s\S]*text-heading-8[\s\S]*text-heading-4/);
  assert.match(page, /api\.admin\.getDashboardMetrics/);
  assert.match(http, /getDashboardMetrics\(\{ signal \} = \{\}\)/);
});

test("admin files route and navigation are enabled only for administrators", async () => {
  const [main, navigation, page] = await Promise.all([
    readFile(new URL("../src/main.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/utils/sideNavigationItems.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-files/AdminFilesPage.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(main, /allowedRoles=\{\["admin"\]\}[\s\S]*path="\/archivos" element=\{<AdminFilesPage \/>\}/);
  assert.match(navigation, /id: "files"[\s\S]*to: "\/archivos"/);
  assert.match(page, /activeItemId="files"/);
  assert.match(page, /<NavigationBar[\s\S]*<section/);
  assert.match(page, /<Loader/);
  assert.match(page, /<EmptyState/);
});

test("file KPI values use bounded storage and upload date formatting", () => {
  assert.equal(formatStorage(0, { maximumFractionDigits: 2 }), "0 B");
  assert.equal(formatStorage(2.33 * 1024 ** 3, { maximumFractionDigits: 2 }), "2,33 GB");
  assert.equal(formatFileUploadDate("2026-06-19T13:34:00"), "19/06/2026 13:34");
  assert.equal(formatFileUploadDate(null), "Sin cargas");
  assert.equal(formatFileUploadDate("fecha-inválida"), "Sin cargas");
});
