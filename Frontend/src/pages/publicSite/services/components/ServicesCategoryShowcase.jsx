import Button from "../../../../components/ui/Button/Button.jsx";
import { useRef } from "react";
import useServicesCategoryScroll from "../hooks/useServicesCategoryScroll.js";
import "./ServicesCategoryShowcase.css";

function ServicesCategoryShowcase({
  active = false,
  categories,
}) {
  const sectionRef = useRef(null);
  const layoutRef = useRef(null);
  const categoryTabRefs = useRef([]);
  const { activeIndex, selectCategory } = useServicesCategoryScroll(
  sectionRef,
  layoutRef,
  categories,
  active,
  );
  const activeCategory = categories[activeIndex] ?? categories[0];

  const handleCategoryKeyDown = (event, currentIndex) => {
    const lastIndex = categories.length - 1;
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    } else {
      return;
    }
    event.preventDefault();
    selectCategory(nextIndex);
    categoryTabRefs.current[nextIndex]?.focus({ preventScroll: true });
  };

  if (!activeCategory) return null;

  return (
    <section
      ref={sectionRef}
      className="flex w-full shrink-0 items-center justify-center bg-[var(--color-neutral-950-uniform)]"
      aria-label="Tipos de diseño"
      data-node-id="4613:2167"
    >
      <div
        className="services-category-showcase__layout flex w-full max-w-[1200px] items-center justify-center px-[var(--spacing-gap-8)] py-[var(--spacing-gap-8)]"
        data-node-id="4613:2165"
      >
        <div
          ref={layoutRef}
          className="services-category-showcase__content flex w-full max-w-[882px] touch-auto items-center justify-center gap-[var(--spacing-gap-8)]"
        >
          <div
            className="services-category-showcase__list relative flex min-w-0 max-w-[514px] flex-1 flex-col items-start gap-[24px] py-[48px] pl-[16px]"
          role="tablist"
          aria-label="Seleccionar tipo de diseño"
          aria-orientation="vertical"
        >
          <span
            className="services-category-showcase__indicator absolute left-[-4px] top-[48px] h-[48px] w-[4px] bg-[var(--color-accent-300)]"
            aria-hidden="true"
            data-category-indicator
            data-node-id="4571:111471"
          />
          {categories.map((category, index) => {
            const isActive = index === activeIndex;
            return (
              <Button layout="content"
                key={category.id}
                htmlType="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="services-category-panel"
                id={`service-tab-${category.id}`}
                tabIndex={isActive ? 0 : -1}
                ref={(node) => { categoryTabRefs.current[index] = node; }}
                className="services-category-showcase__tab text-heading-4 relative w-full cursor-pointer border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-[var(--color-accent-300)]"
                onClick={() => selectCategory(index)}
                onKeyDown={(event) => handleCategoryKeyDown(event, index)}
              >
                <span>
                  {category.label}
                </span>
              </Button>
            );
          })}
          </div>

          <div
            className="services-category-showcase__frame relative aspect-[16/25] w-[320px] max-w-[320px] shrink-0 rounded-[var(--radius-4)] p-[24px]"
          role="tabpanel"
          id="services-category-panel"
          aria-labelledby={`service-tab-${activeCategory.id}`}
          tabIndex={0}
          data-node-id="4571:111481"
        >
          <div className="relative size-full overflow-hidden rounded-[var(--radius-3)] bg-[var(--color-primary-300)]">
            {categories.map((category, index) => (
              <div
                key={category.id}
                className="services-category-showcase__slide absolute inset-0"
                data-category-slide
                aria-hidden={index !== activeIndex}
              >
                {category.id === "residential" ? (
                  <div className="absolute left-1/2 top-[47.92%] h-[108.58%] w-[118.79%] -translate-x-1/2 -translate-y-1/2">
                    <img
                      className="absolute left-[-173.55%] top-[-31.12%] h-[162.23%] w-[438.02%] max-w-none"
                      src={category.image}
                      alt={category.imageAlt}
                    />
                  </div>
                ) : (
                  <img
                    className={category.id === "commercial"
                      ? "absolute left-0 top-1/2 h-[106.73%] w-full max-w-none -translate-y-1/2"
                      : "absolute inset-0 size-full object-cover"}
                    src={category.image}
                    alt={category.imageAlt}
                    decoding="async"
                  />
                )}
              </div>
            ))}
          </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default ServicesCategoryShowcase;
