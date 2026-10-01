import Button from "../../../../components/ui/Button/Button.jsx";
import { useRef } from "react";
import clsx from "clsx";

function PublicSiteNavigationMenu({
  activeNavigationId,
  className,
  navigationItems,
  onNavigate,
  orientation = "horizontal",
  ...props
}) {
  const itemRefs = useRef([]);
  const isVertical = orientation === "vertical";

  function handleKeyDown(event, index) {
    const itemCount = navigationItems.length;
    let nextIndex = null;

    if (itemCount === 0) return;

    if (
      (!isVertical && event.key === "ArrowRight") ||
      (isVertical && event.key === "ArrowDown")
    ) {
      nextIndex = (index + 1) % itemCount;
    } else if (
      (!isVertical && event.key === "ArrowLeft") ||
      (isVertical && event.key === "ArrowUp")
    ) {
      nextIndex = (index - 1 + itemCount) % itemCount;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = itemCount - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    itemRefs.current[nextIndex]?.focus();
  }

  return (
    <div
      className={clsx(
        "public-site-navigation-menu inline-flex max-w-full",
        isVertical
          ? "public-site-navigation-menu--vertical w-fit flex-col items-stretch gap-[16px] overflow-visible"
          : "public-site-navigation-menu--horizontal h-[52px] items-center gap-[8px] overflow-x-auto",
        className,
      )}
      role="group"
      aria-label="Secciones de inicio"
      {...props}
    >
      {navigationItems.map((item, index) => {
        const isActive = item.id === activeNavigationId;

        return (
          <Button layout="content"
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            htmlType="button"
            className={clsx(
              "public-site-navigation__item inline-flex shrink-0 items-center justify-center whitespace-nowrap bg-transparent text-heading-8 outline-none transition-colors duration-150 motion-reduce:transition-none",
              isVertical
                ? "relative h-[52px] w-full px-[4px] py-[8px]"
                : "h-[52px] border-b-2 border-transparent px-[4px] pb-[14px] pt-[8px]",
            )}
            aria-current={isActive ? "page" : undefined}
            onKeyDown={(event) => handleKeyDown(event, index)}
            onClick={() => onNavigate?.(item.id)}
          >
            {item.label}
          </Button>
        );
      })}
    </div>
  );
}

export default PublicSiteNavigationMenu;
