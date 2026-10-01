/* Define valores por defecto, estilos por tamaño/tema y helpers del componente Avatar. */
export const AVATAR_DEFAULT_PROPS = {
  size: "S",
  theme: "Brand 1",
  content: "Text",
  initials: "",
  name: "Juan Silva",
  decorative: true,
};

export const AVATAR_SIZE_STYLES = {
  XS: {
    container: "size-[16px]",
    text: "text-[9px] leading-[10px]",
  },
  S: {
    container: "size-[24px]",
    text: "text-body-4",
  },
  M: {
    container: "size-[40px]",
    text: "text-body-2",
  },
  L: {
    container: "size-[56px]",
    text: "text-body-1",
  },
};

export const AVATAR_THEME_STYLES = {
  Neutral: {
    container: "bg-[var(--color-primary-300)]",
    content: "text-[var(--color-neutral-100-uniform)]",
  },
  "Brand 1": {
    container: "bg-[var(--color-neutral-200)]",
    content: "text-[var(--color-text-300)]",
  },
};

// Combina la configuración base con sobrescrituras específicas.
export function createAvatarProps(overrides = {}) {
  return {
    ...AVATAR_DEFAULT_PROPS,
    ...overrides,
  };
}

// Construye una entrada reutilizable para mostrar variantes del avatar.
export function createAvatarShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createAvatarProps(overrides),
  };
}
