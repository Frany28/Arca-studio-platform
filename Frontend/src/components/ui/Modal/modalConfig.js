export const MODAL_MOUNTS = ["viewport", "contained"];
export const MODAL_ALIGNMENTS = ["Left", "Centered", "Horizontal split"];
export const MODAL_OVERLAY_VARIANTS = ["blurred", "transparent"];
export const MODAL_TRANSITION_PRESETS = ["none", "fade-scale"];
export const MODAL_INSET_BORDER = "relative after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-[var(--color-neutral-200)] after:content-['']";
export const MODAL_INSET_DIVIDER = "relative before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[var(--color-neutral-200)] before:content-['']";
export const MODAL_DARK_CONTRAST = "dark:[--color-text-100:var(--color-neutral-600)] dark:[--color-text-200:var(--color-neutral-600)] dark:[--color-primary-500:var(--color-primary-400)]";

export const MODAL_DEFAULT_PROPS = {
  mount: "viewport",
  visible: true,
  alignment: "Left",
  overlayVariant: "blurred",
  transitionPreset: "fade-scale",
  showDialog: false,
  title: "Título aquí",
  description:
    "Horem ipsum dolor sit amet, consectetur adipiscing elit. Nunc vulputate libero et velit interdum, ac aliquet odio mattis.",
  primaryActionLabel: "Siguiente",
  secondaryActionLabel: "Cerrar",
  checkboxLabel: "No volver a mostrar",
  showCloseButton: true,
};

export function createModalProps(overrides = {}) {
  return {
    ...MODAL_DEFAULT_PROPS,
    ...overrides,
  };
}

export function createModalShowcaseItem(label, overrides = {}) {
  return {
    label,
    props: createModalProps(overrides),
  };
}
