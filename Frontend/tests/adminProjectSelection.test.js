import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { getBulkActionAvailability } from
  "../src/pages/admin-dashboard/components/admin-active-projects/utils/adminProjectBulkActions.js";
import { getAdminProjectsPagination } from
  "../src/pages/admin-dashboard/components/admin-active-projects/utils/adminProjectPagination.js";

test("selected admin project rows use the Figma neutral selection surface", async () => {
  const source = await readFile(
    new URL(
      "../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /isSelected[\s\S]*bg-\[var\(--color-neutral-300\)\]/);
  assert.match(source, /data-selected=\{isSelected \? "true" : undefined\}/);
  assert.match(source, /checked=\{isSelected \? "Yes" : "No"\}/);
  assert.match(
    source,
    /<table className="w-full min-w-\[1093px\] table-fixed border-collapse text-left">/,
  );
  assert.doesNotMatch(source, /import Tooltip/);
  assert.doesNotMatch(source, /<Tooltip/);
  assert.match(source, /tooltip="Ver proyecto"/);
  assert.match(source, /tooltip="Editar proyecto"/);
  assert.match(source, /tooltip="Más opciones"/);
});

test("the Figma table footer stays visible and exposes functional pagination", async () => {
  const scrollSource = await readFile(
    new URL("../src/pages/admin-dashboard/components/admin-active-projects/hooks/useAdminProjectsTableScroll.js", import.meta.url),
    "utf8",
  );
  const source = await readFile(
    new URL(
      "../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    source,
    /<footer[\s\S]*data-selection-footer="true"/,
  );
  assert.match(
    source,
    /title="No hay coincidencias"[\s\S]*data-selection-footer="true"/,
  );
  assert.doesNotMatch(source, /No hay proyectos archivados/);
  assert.match(
    source,
    /\{selectedVisibleCount\} de \{visibleProjects\.length\} seleccionados/,
  );
  assert.match(source, /selectedVisibleCount > 0[\s\S]*Cambiar visibilidad/);
  assert.match(source, />\s*Cambiar visibilidad\s*<\/Button>/);
  assert.match(source, />\s*Archivar\s*<\/Button>/);
  assert.match(source, />\s*Desarchivar\s*<\/Button>/);
  assert.match(
    source,
    /iconLeft=\{<DocumentForward size="20" color="currentColor" \/>\}[\s\S]*onClick=\{\(\) => handleBulkAction\("unarchive"\)\}[\s\S]*>\s*Desarchivar/,
  );
  assert.match(source, /type="Outline"[\s\S]*>\s*Anterior\s*<\/Button>/);
  assert.match(source, /type="Solid"[\s\S]*>\s*Siguiente pág\.\s*<\/Button>/);

  assert.match(source, /handleBulkAction\("change_visibility"\)/);
  assert.match(source, /handleBulkAction\("archive"\)/);
  assert.match(source, /handleBulkAction\("unarchive"\)/);
  assert.match(source, /disabled=\{!pagination\.canGoPrevious/);
  assert.match(source, /disabled=\{!pagination\.canGoNext/);
  assert.match(source, /onClick=\{goToPreviousPage\}/);
  assert.match(source, /onClick=\{goToNextPage\}/);
  assert.match(
    source,
    /scrollToTableEndAfterPreviousRef\.current = true;[\s\S]*setPageIndex\(pagination\.pageIndex - 1\)/,
  );
  assert.match(source, /ref=\{tableFooterRef\}/);
  assert.match(
    scrollSource,
    /tableFooterRef\.current\?\.scrollIntoView\(\{[\s\S]*block: "end"/,
  );
  assert.match(scrollSource, /prefers-reduced-motion: reduce/);
  assert.match(source, /setPageIndex\(pagination\.pageIndex - 1\);[\s\S]*setSelectedProjectIds\(new Set\(\)\)/);
  assert.match(source, /setPageIndex\(pagination\.pageIndex \+ 1\);[\s\S]*setSelectedProjectIds\(new Set\(\)\)/);
  assert.match(source, /await onBulkAction\(\{ action, projects: selectedVisibleProjects \}\)/);
  assert.match(source, /Boolean\(bulkActionPending\)/);
  assert.match(
    source,
    /theme=\{bulkActionFeedback\.type === "error" \? "Danger" : "Success"\}/,
  );
  assert.match(source, /errorTitle: "No se pudieron archivar los proyectos"/);
  assert.match(source, /errorTitle: "No se pudo cambiar la visibilidad"/);
  assert.match(source, /errorTitle: "No se pudieron desarchivar los proyectos"/);
  assert.match(source, /title=\{bulkActionFeedback\.title\}/);
  assert.match(source, /<AlertToast/);
  assert.match(source, /trigger=\{bulkActionFeedback\?\.id\}/);
  assert.match(source, /onDismiss=\{\(\) => setBulkActionFeedback\(null\)\}/);
});

test("admin project pagination clamps pages and reports button states", () => {
  const projects = Array.from({ length: 12 }, (_, index) => ({ id: index + 1 }));

  assert.deepEqual(getAdminProjectsPagination(projects, 0), {
    canGoNext: true,
    canGoPrevious: false,
    pageCount: 3,
    pageIndex: 0,
    pageProjects: projects.slice(0, 5),
  });
  assert.deepEqual(getAdminProjectsPagination(projects, 1), {
    canGoNext: true,
    canGoPrevious: true,
    pageCount: 3,
    pageIndex: 1,
    pageProjects: projects.slice(5, 10),
  });
  assert.deepEqual(getAdminProjectsPagination(projects, 99), {
    canGoNext: false,
    canGoPrevious: true,
    pageCount: 3,
    pageIndex: 2,
    pageProjects: projects.slice(10),
  });
  assert.deepEqual(getAdminProjectsPagination([], 4), {
    canGoNext: false,
    canGoPrevious: false,
    pageCount: 1,
    pageIndex: 0,
    pageProjects: [],
  });
});

test("admin filters use connected four-row multiple-checkbox menus", async () => {
  const filtersSource = await readFile(
    new URL("../src/pages/admin-dashboard/components/admin-active-projects/hooks/useAdminProjectFilters.js", import.meta.url),
    "utf8",
  );
  const source = await readFile(
    new URL(
      "../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.jsx",
      import.meta.url,
    ),
    "utf8",
  );
  const styles = await readFile(
    new URL(
      "../src/pages/admin-dashboard/components/admin-active-projects/AdminActiveProjects.css",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(filtersSource, /type: "Checkbox"/);
  assert.match(source, /<DropdownMenu[\s\S]*multiple[\s\S]*onItemsChange=\{handlePersonFilterItemsChange\}/);
  assert.match(source, /const personnelFilterLabel = "Filtrar por personal"/);
  assert.match(source, /label="Filtrar por status"[\s\S]*items=\{statusFilterItems\}[\s\S]*multiple[\s\S]*onItemsChange=\{handleStatusFilterItemsChange\}/);
  assert.match(source, /onItemsChange=\{handleStatusFilterItemsChange\}/);
  assert.match(filtersSource, /statusFilterIds\.includes\(getStatusFilterId\(project\.status\)\)/);
  assert.match(source, /rowHeightClassName="h-\[35px\]"/);
  assert.match(filtersSource, /personFilterIds\.includes\(String\(person\.id \|\| person\.name\)\)/);
  assert.match(styles, /admin-active-projects__filter-menu[\s\S]*top: calc\(100% - 1px\)/);
  assert.match(styles, /admin-active-projects__filter-menu[\s\S]*max-height: 168px/);
  assert.match(styles, /admin-active-projects__filter-menu[\s\S]*width: 100%/);
  assert.match(styles, /admin-active-projects__filter-menu[\s\S]*max-width: 100%/);
  assert.match(styles, /admin-active-projects__filter-menu[\s\S]*overflow-x: hidden/);
  assert.match(styles, /admin-active-projects__filter-menu > button p[\s\S]*white-space: normal/);
  assert.match(styles, /admin-active-projects__filter-menu > button p[\s\S]*overflow-wrap: anywhere/);
  assert.match(styles, /@supports not selector\(::-webkit-scrollbar\)/);
  assert.match(styles, /scrollbar-width: thin/);
  assert.match(styles, /::-webkit-scrollbar[\s\S]*width: 5px/);
  assert.match(styles, /::-webkit-scrollbar[\s\S]*height: 0/);
  assert.match(styles, /::-webkit-scrollbar-button:vertical:decrement/);
  assert.match(styles, /::-webkit-scrollbar-button:vertical:increment/);
  assert.match(styles, /::-webkit-scrollbar-button[\s\S]*appearance: none/);
  assert.match(styles, /::-webkit-scrollbar-button[\s\S]*display: none/);
  assert.match(styles, /::-webkit-scrollbar-thumb[\s\S]*border-right: 1px solid transparent/);
  assert.match(styles, /::-webkit-scrollbar-thumb[\s\S]*background-clip: padding-box/);
});

test("bulk project actions follow the selection rules", () => {
  assert.deepEqual(getBulkActionAvailability([]), {
    canChangeVisibility: false,
    canArchive: false,
    canUnarchive: false,
  });

  assert.deepEqual(
    getBulkActionAvailability([
      { id: 1, status: "archived" },
      { id: 2, status: "archived" },
    ]),
    {
      canChangeVisibility: false,
      canArchive: false,
      canUnarchive: true,
    },
  );

  assert.deepEqual(
    getBulkActionAvailability([
      { id: 1, status: "completed", isPublic: false },
      { id: 2, status: "finished", isPublic: false },
    ]),
    {
      canChangeVisibility: true,
      canArchive: true,
      canUnarchive: false,
    },
  );

  assert.deepEqual(
    getBulkActionAvailability([
      { id: 1, status: "completed", isPublic: true },
      { id: 2, status: "finished", isPublic: true },
    ]),
    {
      canChangeVisibility: true,
      canArchive: true,
      canUnarchive: false,
    },
  );

  assert.deepEqual(
    getBulkActionAvailability([
      { id: 1, status: "completed", isPublic: true },
      { id: 2, status: "finished", isPublic: false },
    ]),
    {
      canChangeVisibility: false,
      canArchive: true,
      canUnarchive: false,
    },
  );

  assert.deepEqual(
    getBulkActionAvailability([
      { id: 1, status: "completed" },
      { id: 2, status: "in_process" },
    ]),
    {
      canChangeVisibility: false,
      canArchive: true,
      canUnarchive: false,
    },
  );

  assert.deepEqual(
    getBulkActionAvailability([
      { id: 1, status: "completed", deletedAt: "2026-08-24T00:00:00Z" },
      { id: 2, status: "completed", archived: true },
    ]),
    {
      canChangeVisibility: false,
      canArchive: false,
      canUnarchive: true,
    },
  );

  assert.deepEqual(
    getBulkActionAvailability([
      { id: 1, status: "completed", isArchived: true },
      { id: 2, status: "completed" },
    ]),
    {
      canChangeVisibility: false,
      canArchive: false,
      canUnarchive: false,
    },
  );
});
