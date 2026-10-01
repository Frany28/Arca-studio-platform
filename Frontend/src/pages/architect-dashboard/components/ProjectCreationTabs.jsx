import Button from "../../../components/ui/Button/Button.jsx";
import clsx from "clsx";

const PROJECT_CREATION_TABS = [
  { id: "general", label: "Información general", heightClassName: "h-[44px]" },
  { id: "renders", label: "Renders e Imágenes", heightClassName: "h-[44px]" },
  { id: "documents", label: "Documentos", heightClassName: "h-[44px]" },
  { id: "tracking", label: "Seguimiento", heightClassName: "h-[36px]" },
  { id: "warranties", label: "Garantías", heightClassName: "h-[36px]" },
];

function ProjectCreationTabs({ activeItemId = "general", className }) {
  return (
    <nav
      className={clsx(
        "flex w-[152px] shrink-0 flex-col items-start gap-[8px]",
        className,
      )}
      aria-label="Secciones del proyecto"
    >
      {PROJECT_CREATION_TABS.map((item) => {
        const isActive = item.id === activeItemId;

        return (
          <Button layout="content"
            key={item.id}
            htmlType="button"
            className={clsx(
              "flex cursor-pointer items-center justify-center px-[12px] py-[8px] text-heading-8 tracking-[-0.5px] transition-colors duration-150",
              item.heightClassName,
              isActive
                ? "border-l-[2px] border-[var(--color-primary-300)] text-[var(--color-text-300)]"
                : "text-[var(--color-text-100)] hover:text-[var(--color-text-200)]",
            )}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </Button>
        );
      })}
    </nav>
  );
}

export default ProjectCreationTabs;
