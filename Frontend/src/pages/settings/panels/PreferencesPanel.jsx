import clsx from "clsx";
import DropdownMenu from "../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import Toggle from "../../../components/ui/Toggle/Toggle.jsx";
import PreferenceItem from "../PreferenceItem.jsx";
import { BellIcon, CallIcon, SmsIcon, SunIcon } from "../settingsIcons.jsx";
import { SETTINGS_MOBILE_FIELD_CLASS_NAME } from "../settingsLayoutClassNames.js";

export default function PreferencesPanel({
  themePreference,
  setThemePreference,
  isThemeMenuOpen,
  setIsThemeMenuOpen,
  commentsNotificationsEnabled,
  setCommentsNotificationsEnabled,
  emailNotificationsEnabled,
  setEmailNotificationsEnabled,
  whatsappNotificationsEnabled,
  setWhatsappNotificationsEnabled,
  applyThemePreference,
  showObservationNotifications = true,
}) {
  const themeItems = [
    { id: "oscuro", label: "Oscuro", type: "Text" },
    { id: "claro", label: "Claro", type: "Text" },
    { id: "sistema", label: "Sistema", type: "Text" },
  ];
  const selectedTheme =
    themeItems.find((item) => item.id === themePreference) ?? themeItems[0];

  return (
    <div className="flex flex-1 flex-col items-center gap-4">
      <PreferenceItem
        className="border-b border-[var(--color-neutral-200)]"
        icon={<SunIcon className="size-5" />}
        title="Tema"
        description="Seleccionar tema"
        rightContent={
          <DropdownMenu
            type="Text"
            label={selectedTheme.label}
            supportingText=""
            items={themeItems}
            selectedItemId={selectedTheme.id}
            open={isThemeMenuOpen}
            onOpenChange={setIsThemeMenuOpen}
            onItemSelect={(item) => {
              setThemePreference(item.id);
              applyThemePreference(item.id);
              setIsThemeMenuOpen(false);
            }}
            interactive
            className={clsx("!w-[320px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
            triggerWrapperClassName="!h-[39px]"
            triggerClassName="!h-[39px] px-[16px]"
            contentClassName="!px-0 !py-[2px] !pb-[2px] flex-col items-start gap-[4px]"
            rowHeightClassName="!h-[39px]"
            aria-label="Seleccionar tema"
          />
        }
      />

      {showObservationNotifications ? (
        <PreferenceItem
          className="border-b border-[var(--color-neutral-200)]"
          icon={<BellIcon className="size-5" />}
          title="Notificaciones de observaciones"
          description="Recibir notificaciones de nuevas observaciones."
          rightContent={
            <Toggle
              size="S"
              active={commentsNotificationsEnabled}
              interactive
              onActiveChange={setCommentsNotificationsEnabled}
            />
          }
        />
      ) : null}

      <PreferenceItem
        className="border-b border-[var(--color-neutral-200)]"
        icon={<SmsIcon className="size-5" />}
        title="Correo Electrónico"
        description="Recibir actualizaciones en su bandeja de entrada."
        rightContent={
          <Toggle
            size="S"
            active={emailNotificationsEnabled}
            interactive
            onActiveChange={setEmailNotificationsEnabled}
          />
        }
      />

      <PreferenceItem
        icon={<CallIcon className="size-5" />}
        title="Whatsapp"
        description="Recibir actualizaciones en sus mensajes."
        rightContent={
          <Toggle
            size="S"
            active={whatsappNotificationsEnabled}
            interactive
            onActiveChange={setWhatsappNotificationsEnabled}
          />
        }
      />
    </div>
  );
}
