import clsx from "clsx";

import { getAvatarPresentation } from "../../../utils/avatarPresentation.js";
import Avatar from "../Avatar/Avatar.jsx";
import Badge from "../Badge/Badge.jsx";
import FileAttachmentIcons from "../FileAttachmentIcons/FileAttachmentIcons.jsx";

/**
 * Presenta una actividad preparada con autor, archivo o estado y fecha.
 * Si recibe onSelect utiliza un botón nativo y entrega id y type al callback local;
 * el drawer conecta ese callback con el objeto completo recibido del consumidor.
 * @param {Object} props Datos de presentación y selección opcional.
 * @returns {import("react").ReactElement} Actividad con interacción opcional.
 */
export default function ActivityItem({
  avatarSrc,
  id,
  name,
  action,
  timestamp,
  type,
  status,
  fileType,
  fileName,
  fileSize,
  projectName,
  roleCode,
  onSelect,
}) {
  const isInteractive = typeof onSelect === "function";
  const Container = isInteractive ? "button" : "div";
  const displayName =
    name && typeof name === "object"
      ? (name.name ?? name.email ?? String(name))
      : name;
  const avatar = getAvatarPresentation({
    identity: id,
    name: displayName,
    roleCode,
    src: avatarSrc,
  });

  return (
    <Container
      type={isInteractive ? "button" : undefined}
      className={clsx(
        "flex w-full flex-col gap-[2px] text-left",
        isInteractive && "cursor-pointer rounded-[8px] focus:outline-none",
      )}
      onClick={isInteractive ? () => onSelect({ id, type }) : undefined}
    >
      <article className="flex w-full items-start gap-[8px] overflow-hidden rounded-[8px] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-10)] p-[8px]">
        <Avatar size="M" name={displayName} {...avatar} decorative />

        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <p className="text-[14px] leading-[17px] tracking-[-0.5px]">
            <span className="font-medium text-[var(--color-text-300)]">
              {displayName}
            </span>{" "}
            <span className="font-normal text-[var(--color-text-200)]">
              {action}
            </span>
            {projectName ? (
              <>
                {" "}
                <span className="font-medium text-[var(--color-text-200)]">
                  {projectName}
                </span>
              </>
            ) : null}
          </p>

          {type === "file" ? (
            <div className="flex items-center gap-[8px]">
              <FileAttachmentIcons
                type={fileType}
                size="compact"
                aria-label={`Archivo ${fileType}`}
              />
              <span className="text-[10px] font-normal leading-[12px] tracking-[-0.5px] text-[var(--color-text-200)]">
                {fileName}
              </span>
              <span className="text-[10px] font-normal leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
                {fileSize}
              </span>
            </div>
          ) : type === "status" && status ? (
            <div className="flex items-center gap-[2px]">
              <Badge theme="Info" variation="Simple" size="S" label={status} />
            </div>
          ) : null}
        </div>
      </article>

      <p className="w-full text-right text-[10px] font-normal leading-[12px] tracking-[-0.5px] text-[var(--color-text-100)]">
        {timestamp}
      </p>
    </Container>
  );
}
