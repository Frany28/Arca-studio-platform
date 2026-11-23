// Maquetación compartida de los visores de documentos del administrador de archivos (versiones de
// archivos y PDF de cotizaciones), para que ambos reproduzcan la misma composición de Figma.

// Composición de Figma: escritorio 3727:682849 (modal 3727:682968 de 790 px centrado y drawer
// 3934:182047 de 312 px a la derecha, a toda altura), tablet 3952:187549 (el modal ocupa la columna
// izquierda con 24 px de margen y toda la altura) y móvil 3953:297003 (modal arriba y el historial
// como hoja inferior, todo con desplazamiento vertical). El margen izquierdo centra el modal en la
// ventana mientras cabe junto al drawer: (100% - 790) / 2, limitado por 100% - 312 - 790 - 16.
export const VIEWER_LAYOUT = "flex h-dvh w-screen flex-col overflow-y-auto overscroll-contain min-[768px]:flex-row min-[768px]:overflow-hidden";
export const MODAL_AREA = "flex shrink-0 p-[16px] min-[768px]:min-h-0 min-[768px]:min-w-0 min-[768px]:flex-1 min-[768px]:items-center min-[768px]:py-[24px] min-[768px]:pr-[16px] min-[768px]:pl-[max(24px,min(calc((100%_-_790px)_/_2),calc(100%_-_1118px)))] min-[768px]:max-[1279px]:items-stretch min-[768px]:max-[1279px]:pr-[24px]";
export const MODAL_BOX = "flex w-[790px] max-w-full flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)] min-[768px]:max-h-full";
// Área del documento: 527 px en escritorio (Figma), 213 px en móvil y toda la altura libre en tablet.
export const DOCUMENT_AREA = "h-[527px] min-h-[200px] max-[767px]:h-[213px] max-[767px]:min-h-0 min-[768px]:max-h-[calc(100dvh-211px)] min-[768px]:max-[1279px]:h-auto min-[768px]:max-[1279px]:max-h-none min-[768px]:max-[1279px]:flex-1";
export const DRAWER = "flex w-full flex-1 flex-col rounded-t-[var(--radius-3)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)] min-[768px]:h-full min-[768px]:w-[312px] min-[768px]:flex-none min-[768px]:overflow-y-auto min-[768px]:overscroll-contain min-[768px]:rounded-t-none min-[768px]:rounded-l-[var(--radius-3)]";
