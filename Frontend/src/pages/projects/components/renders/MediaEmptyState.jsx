import clsx from "clsx";
import EmptyState from "../../../../components/ui/EmptyState.jsx";

export default function MediaEmptyState({
  title,
  description,
  className,
  small = false,
  panel = false,
  circlePositionClassName = "",
}) {
  return (
    <div
      className={clsx(
        "relative flex w-full items-center justify-center overflow-visible",
        panel &&
          "rounded-[var(--radius-3)] bg-[rgba(42,41,41,0.10)] dark:bg-[rgba(42,41,41,0.10)]",
        className,
      )}
    >
      <EmptyState
        title={title}
        description={description}
        size={small ? "S" : "M"}
        showFeaturedIcon
        showActions
        showSecondaryAction={false}
        primaryActionLabel="Actualizar"
        className={clsx(
          "w-full overflow-visible",
          circlePositionClassName,
          small ? "min-h-[206px]" : "min-h-[254px]",
        )}
      />
    </div>
  );
}
