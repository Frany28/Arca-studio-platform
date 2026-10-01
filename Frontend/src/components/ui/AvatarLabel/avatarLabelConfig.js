/* Define valores por defecto y estilos responsivos del componente AvatarLabel. */
export const AVATAR_LABEL_DEFAULT_PROPS = {
  size: "M",
  label: "Nombre aquí",
  subtitle: "Subdescripción",
  showLabel: true,
  showSubtitle: true,
  avatarTheme: "Neutral",
  avatarContent: "Icon",
  avatarInitials: "",
  avatarName: "",
  avatarDecorative: true,
};

export const AVATAR_LABEL_SIZE_STYLES = {
  S: {
    container: "gap-[8px]",
    label: "text-body-4",
    subtitle: "text-body-5",
    textGroup: "gap-[2px]",
    avatarSize: "S",
  },
  M: {
    container: "gap-[12px]",
    label: "text-heading-8",
    subtitle: "text-body-4",
    textGroup: "gap-[2px]",
    avatarSize: "M",
  },
  L: {
    container: "gap-[12px]",
    label: "text-heading-8",
    subtitle: "text-body-4",
    textGroup: "gap-[2px]",
    avatarSize: "L",
  },
};

// Combina la configuración base con variantes específicas de la etiqueta.
export function createAvatarLabelProps(overrides = {}) {
  return {
    ...AVATAR_LABEL_DEFAULT_PROPS,
    ...overrides,
  };
}

// Genera una entrada reutilizable para mostrar variantes de AvatarLabel.
export function createAvatarLabelShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createAvatarLabelProps(overrides),
  };
}
