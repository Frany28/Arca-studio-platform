export const ADMIN_PROJECTS_PAGE_SIZE = 5;

export function getAdminProjectsPagination(
  projects,
  requestedPageIndex,
  pageSize = ADMIN_PROJECTS_PAGE_SIZE,
) {
  const safeProjects = Array.isArray(projects) ? projects : [];
  const safePageSize = Number.isInteger(pageSize) && pageSize > 0
    ? pageSize
    : ADMIN_PROJECTS_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(safeProjects.length / safePageSize));
  const normalizedPageIndex = Number.isInteger(requestedPageIndex)
    ? requestedPageIndex
    : 0;
  const pageIndex = Math.min(Math.max(normalizedPageIndex, 0), pageCount - 1);
  const startIndex = pageIndex * safePageSize;

  return {
    canGoNext: pageIndex < pageCount - 1,
    canGoPrevious: pageIndex > 0,
    pageCount,
    pageIndex,
    pageProjects: safeProjects.slice(startIndex, startIndex + safePageSize),
  };
}
