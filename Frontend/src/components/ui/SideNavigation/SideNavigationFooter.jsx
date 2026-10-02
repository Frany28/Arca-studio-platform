import clsx from "clsx";

import AvatarLabel from "../AvatarLabel/AvatarLabel.jsx";
import Button from "../Button/Button.jsx";
import { LogoutIcon } from "./SideNavigationIcons.jsx";

/**
 * Presenta la identidad ya resuelta por el padre y muestra logout al expandirse.
 * Delega la acción de sesión y el foco de puntero sin acceder a autenticación global.
 *
 * @param {Object} props Datos de identidad y callbacks del footer.
 * @param {boolean} props.isExpanded Visibilidad de nombre, correo y acción de sesión.
 * @param {string} props.nodeId Identificador de diseño del footer en su modo actual.
 * @param {string} props.userName Nombre visible y texto alternativo del avatar.
 * @param {string} props.userEmail Correo mostrado como subtítulo.
 * @param {Object} props.userAvatar Presentación obtenida mediante getAvatarPresentation.
 * @param {Function} [props.onLogoutClick] Acción de sesión proporcionada por el consumidor.
 * @param {Function} props.onPointerFocusClear Limpia el foco al terminar mouse o touch.
 * @returns {import("react").ReactElement} Identidad y acción con la estructura original.
 */
export default function SideNavigationFooter({
  isExpanded,
  nodeId,
  userName,
  userEmail,
  userAvatar,
  onLogoutClick,
  onPointerFocusClear,
}) {
  return (
    <div
      data-node-id={nodeId}
      className={clsx(
        "mt-[20px] flex min-w-0 items-center",
        isExpanded ? "w-full justify-between gap-[12px]" : "self-start",
      )}
    >
      <AvatarLabel
        className="min-w-0 flex-1"
        size="M"
        label={userName}
        subtitle={userEmail}
        showLabel={isExpanded}
        showSubtitle={isExpanded}
        avatarTheme={userAvatar.theme}
        avatarContent={userAvatar.content}
        avatarInitials={userAvatar.initials}
        avatarSrc={userAvatar.src}
        avatarAlt={userName}
        avatarDecorative={false}
      />

      {isExpanded ? (
        <Button
          className="shrink-0"
          theme="Primary"
          type="Ghost"
          size="S"
          showText={false}
          showLeftIcon
          showRightIcon={false}
          iconLeft={<LogoutIcon className="size-5" />}
          tooltipPosition="Right"
          aria-label="Cerrar sesión"
          onClick={onLogoutClick}
          onMouseUp={onPointerFocusClear}
          onTouchEnd={onPointerFocusClear}
        />
      ) : null}
    </div>
  );
}
