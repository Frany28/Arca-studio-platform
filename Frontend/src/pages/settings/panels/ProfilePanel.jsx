import clsx from "clsx";
import Avatar from "../../../components/ui/Avatar/Avatar.jsx";
import Badge from "../../../components/ui/Badge/Badge.jsx";
import Button from "../../../components/ui/Button/Button.jsx";
import HintText from "../../../components/ui/HintText/HintText.jsx";
import Input from "../../../components/ui/Input/Input.jsx";
import {
  BuildingsIcon,
  InfoCircleIcon,
  SmsIcon,
  UserIcon,
} from "../settingsIcons.jsx";
import { SETTINGS_MOBILE_FIELD_CLASS_NAME, SETTINGS_MOBILE_ROW_CLASS_NAME } from "../settingsLayoutClassNames.js";

export default function ProfilePanel({
  profileName,
  setProfileName,
  companyName,
  setCompanyName,
  email,
  primaryPhone,
  secondaryPhone,
  roleLabel = "Usuario",
  avatarInitials,
  avatarSrc,
  onUploadImageClick,
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-4">
      <div className={clsx("flex w-[664px] max-w-full items-start gap-[24px] border-b border-[var(--color-neutral-200)] pb-[16px]", SETTINGS_MOBILE_ROW_CLASS_NAME)}>
        <Input
          label="Nombre"
          required={false}
          information={false}
          showLabelInfo={false}
          showHint={false}
          size="S"
          type="Default input"
          state="Default"
          value={profileName}
          onChange={(event) => setProfileName(event.target.value)}
          leftIcon={<UserIcon className="size-5" />}
          rightIcon={null}
          showLeftIcon
          showRightIcon={false}
          className={clsx("w-[320px] max-w-none", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
        />
        <Input
          label="Empresa"
          required={false}
          information={false}
          showLabelInfo={false}
          showHint={false}
          size="S"
          type="Default input"
          state="Default"
          value={companyName}
          onChange={(event) => setCompanyName(event.target.value)}
          leftIcon={<BuildingsIcon className="size-5" />}
          rightIcon={null}
          showLeftIcon
          showRightIcon={false}
          className={clsx("w-[320px] max-w-none", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
        />
      </div>

      <div className={clsx("flex w-[664px] max-w-full items-start gap-[24px] border-b border-[var(--color-neutral-200)] pb-[16px]", SETTINGS_MOBILE_ROW_CLASS_NAME)}>
        <Input
          label="Correo electrónico"
          required={false}
          information={false}
          showLabelInfo={false}
          showHint={false}
          size="S"
          type="Default input"
          state="Disabled"
          value={email}
          onChange={() => {}}
          leftIcon={<SmsIcon className="size-5" />}
          rightIcon={null}
          showLeftIcon
          showRightIcon={false}
          className={clsx("w-[320px] min-w-[320px] max-w-[320px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
          disabled
        />
        <div className={clsx("flex w-[320px] flex-col gap-[8px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}>
          <span className="text-heading-8 tracking-[-0.5px] text-[var(--color-neutral-400)]">
            Rol
          </span>
          <Badge
            label={roleLabel}
            theme="Neutral"
            variation="Simple"
            size="M"
            className="w-fit px-[8px] py-[4px]"
          />
        </div>
      </div>

      <div className={clsx("flex w-[664px] max-w-full items-start gap-[24px] border-b border-[var(--color-neutral-200)] pb-[16px]", SETTINGS_MOBILE_ROW_CLASS_NAME)}>
        {[primaryPhone, secondaryPhone].map((phone, index) => (
          <div
            key={index}
            className={clsx("flex w-[320px] min-w-[320px] max-w-[320px] flex-col gap-[8px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
          >
            <Input
              label="Teléfono"
              required={false}
              information={false}
              showLabelInfo={false}
              showHint={false}
              size="S"
              type="Phone number"
              state="Disabled"
              value={phone}
              onChange={() => {}}
              showLeftIcon={false}
              showRightIcon={false}
              countryCode="US"
              countryPrefix="+1"
              className={clsx("w-[320px] min-w-[320px] max-w-[320px]", SETTINGS_MOBILE_FIELD_CLASS_NAME)}
              disabled
            />
            <HintText
              state="Disabled"
              hintText="Le enviaremos un código para la verificación."
              icon={<InfoCircleIcon className="size-4" />}
              className="w-full"
            />
          </div>
        ))}
      </div>

      <div className="flex w-[664px] max-w-full flex-col gap-[8px]">
        <div className="flex w-full items-center justify-between border-b border-[var(--color-neutral-200)] pb-[16px]">
          <div className="flex flex-col gap-[2px]">
            <span className="text-heading-8 tracking-[-0.5px] text-[var(--color-text-300)]">
              Avatar
            </span>
            <p className="text-body-4 tracking-[-0.5px] text-[var(--color-text-200)]">
              Este es su avatar. Haga clic para cargar uno desde sus archivos.
            </p>
          </div>
          <div className="flex items-center gap-[16px]">
            <Avatar
              size="L"
              content={avatarSrc ? "Image" : "Text"}
              initials={avatarInitials}
              src={avatarSrc}
              alt="Avatar del usuario"
              decorative={false}
            />
            <Button
              theme="Primary"
              type="Outline"
              size="S"
              fitContent
              showLeftIcon={false}
              showRightIcon={false}
              onClick={onUploadImageClick}
            >
              Subir imagen
            </Button>
          </div>
        </div>
        <HintText
          state="Default"
          hintText="Un avatar es opcional, aunque se recomienda su uso."
          icon={<InfoCircleIcon className="size-4" />}
          className="w-full"
        />
      </div>
    </div>
  );
}
