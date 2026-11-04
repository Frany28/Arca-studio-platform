import { useId, useMemo, useRef, useState } from "react";
import { Buildings, Sms, User } from "iconsax-react";

import { useInvalidFieldFocus } from "../../hooks/useInvalidFieldFocus.js";

import Modal, { ModalCloseButton } from "../../components/ui/Modal/Modal.jsx";
import Input from "../../components/ui/Input/Input.jsx";
import Label from "../../components/ui/Label/Label.jsx";
import HintText from "../../components/ui/HintText/HintText.jsx";
import DropdownMenu from "../../components/ui/DropdownMenu/DropdownMenu.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import PHONE_COUNTRY_OPTIONS from "../../components/ui/Input/phoneCountryOptions.js";
import { PASSWORD_REQUIREMENT_RULES } from "../../components/ui/Input/inputConfig.js";

const INITIAL_VALUES = {
  companyName: "",
  email: "",
  fullName: "",
  phone: "",
  phonePrefix: "+1",
  roleCode: "",
  secondaryPhone: "",
  secondaryPhonePrefix: "+1",
  status: "active",
};

const STATUS_ITEMS = [
  { id: "active", label: "Activo", type: "Text" },
  { id: "blocked", label: "Suspendido", type: "Text" },
  { id: "inactive", label: "Deshabilitado", type: "Text" },
];

function splitPhone(value) {
  const normalized = String(value || "").replace(/\D/g, "");
  if (!normalized) return { countryCode: "US", number: "", prefix: "+1" };

  const option = [...PHONE_COUNTRY_OPTIONS]
    .sort((left, right) => right.dialCode.length - left.dialCode.length)
    .find((item) => normalized.startsWith(item.dialCode.replace(/\D/g, "")));
  const prefixDigits = option?.dialCode.replace(/\D/g, "") || "1";

  return {
    countryCode: option?.countryCode || "US",
    number: normalized.slice(prefixDigits.length),
    prefix: option?.dialCode || "+1",
  };
}

function getInitialValues(user, roles) {
  const phone = splitPhone(user?.phone);
  const secondaryPhone = splitPhone(user?.secondaryPhone);

  return {
    ...INITIAL_VALUES,
    companyName: user?.companyName || "",
    email: user?.email || "",
    fullName: user?.name || "",
    phone: phone.number,
    phoneCountryCode: phone.countryCode,
    phonePrefix: phone.prefix,
    roleCode: user?.role?.code || roles.find((role) => role.code === "client")?.code || roles[0]?.code || "",
    secondaryPhone: secondaryPhone.number,
    secondaryPhoneCountryCode: secondaryPhone.countryCode,
    secondaryPhonePrefix: secondaryPhone.prefix,
    status: user?.status || "active",
  };
}

function validate(values) {
  const errors = {};
  if (values.fullName.trim().split(/\s+/).filter(Boolean).length < 2) {
    errors.fullName = "Ingresa nombre y apellido.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    errors.email = "Ingresa un correo electrónico válido.";
  }
  if (!values.roleCode) errors.roleCode = "Selecciona un rol.";
  if (!values.status) errors.status = "Selecciona un status.";

  for (const key of ["phone", "secondaryPhone"]) {
    const digits = values[key].replace(/\D/g, "");
    if (values[key] && (digits.length < 8 || digits.length > 15)) {
      errors[key] = "Ingresa un teléfono válido.";
    }
  }
  if (values.phone && values.secondaryPhone) {
    const primary = values.phone.replace(/\D/g, "");
    const secondary = values.secondaryPhone.replace(/\D/g, "");
    if (primary === secondary) errors.secondaryPhone = "Los teléfonos deben ser diferentes.";
  }
  return errors;
}

function apiFieldsToErrors(fields) {
  const next = {};
  for (const [path, message] of Object.entries(fields || {})) {
    const field = path.replace(/^body\./, "");
    if (field in INITIAL_VALUES) next[field] = message;
  }
  return next;
}

function SelectField({ error, items, label, onSelect, selectedItemId }) {
  const errorId = `${useId()}-error`;
  return (
    <div className="flex min-w-0 flex-col gap-[8px]">
      <Label label={label} required information={false} />
      <DropdownMenu
        type="Text"
        label={`Seleccionar ${label.toLowerCase()}`}
        items={items}
        selectedItemId={selectedItemId}
        onItemSelect={onSelect}
        className="w-full"
        aria-label={label}
        // aria-invalid en el contenedor del menú (la navegación a errores enfoca su disparador) y
        // el mensaje asociado al disparador.
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? <HintText id={errorId} state="Error" hintText={error} role="alert" /> : null}
    </div>
  );
}

function AdminUserFormModal({ mode = "create", onClose, onSubmit, open, roles = [], user = null }) {
  const editing = mode === "edit";
  const [values, setValues] = useState(() => getInitialValues(user, roles));
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editStep, setEditStep] = useState("details");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordTouched, setPasswordTouched] = useState({ password: false, confirmPassword: false });
  const [passwordError, setPasswordError] = useState("");
  const roleItems = useMemo(
    () => roles.map((role) => ({ id: role.code, label: role.name, type: "Text" })),
    [roles],
  );
  // El diálogo contiene el paso visible (datos o contraseña); cada formulario desplaza su contenido.
  const dialogRef = useRef(null);
  const focusInvalidField = useInvalidFieldFocus({ getContainer: () => dialogRef.current });

  const updateValue = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setSubmitError("");
  };

  const validateField = (field) => {
    const nextErrors = validate(values);
    setErrors((current) => ({ ...current, [field]: nextErrors[field] || "" }));
  };

  const buildPayload = () => ({
    companyName: values.companyName.trim() || undefined,
    email: values.email.trim().toLowerCase(),
    fullName: values.fullName.trim(),
    phone: values.phone ? `${values.phonePrefix}${values.phone}` : undefined,
    roleCode: values.roleCode,
    secondaryPhone: values.secondaryPhone
      ? `${values.secondaryPhonePrefix}${values.secondaryPhone}`
      : undefined,
    status: values.status,
  });

  const submitPayload = async (payload) => {
    setSubmitting(true);
    setSubmitError("");
    setPasswordError("");
    try {
      await onSubmit(payload);
    } catch (error) {
      const fieldErrors = apiFieldsToErrors(error?.fields);
      if (Object.keys(fieldErrors).length) {
        setErrors((current) => ({ ...current, ...fieldErrors }));
        setEditStep("details");
      }
      const nextPasswordError = error?.fields?.["body.password"];
      if (nextPasswordError) setPasswordError(nextPasswordError);
      // Misma actualización que el cambio de paso: la navegación corre cuando «details» ya está
      // montado. Sin errores por campo no hay nada que enfocar y el mensaje general se mantiene.
      focusInvalidField();
      setSubmitError(error?.message || (editing ? "No se pudo actualizar el usuario." : "No se pudo crear el usuario."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDetailsSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validate(values);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      focusInvalidField();
      return;
    }

    if (editing) {
      setSubmitError("");
      setEditStep("password");
      return;
    }

    await submitPayload(buildPayload());
  };

  const passwordIsEmpty = !password && !confirmPassword;
  const passwordIsValid = PASSWORD_REQUIREMENT_RULES.every((requirement) => requirement.test(password));
  const passwordsMatch = Boolean(password) && password === confirmPassword;
  const passwordState = passwordError || (passwordTouched.password && password && !passwordIsValid)
    ? "Error"
    : password
      ? "Filled"
      : "Default";
  const confirmPasswordState = passwordTouched.confirmPassword && !passwordIsEmpty && !passwordsMatch
    ? "Error"
    : confirmPassword
      ? "Filled"
      : "Default";

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setPasswordTouched({ password: true, confirmPassword: true });
    setPasswordError("");

    if (!passwordIsEmpty && (!passwordIsValid || !passwordsMatch)) {
      focusInvalidField();
      return;
    }

    await submitPayload({
      ...buildPayload(),
      ...(password ? { password } : {}),
    });
  };

  const textInputProps = (field) => ({
    size: "S",
    value: values[field],
    state: errors[field] ? "Error" : "Default",
    showHint: Boolean(errors[field]),
    hintText: errors[field],
    onChange: (event) => updateValue(field, event.target.value),
    onBlur: () => validateField(field),
  });

  return (
    <Modal mount="viewport" visible={open} onClose={submitting ? undefined : onClose} className="z-[100]">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${mode}-admin-user-title`}
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[696px] flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="relative h-[62px] shrink-0 border-b border-[var(--color-neutral-200)]">
          <h2 id={`${mode}-admin-user-title`} className="text-heading-4 absolute left-[16px] top-[16px] m-0 text-[var(--color-text-300)]">{editing ? "Editar usuario" : "Nuevo usuario"}</h2>
          <div className="absolute right-0 top-0">
            <ModalCloseButton
              disabled={submitting}
              ariaLabel={`Cerrar formulario de ${editing ? "edición" : "nuevo usuario"}`}
              onClick={onClose}
            />
          </div>
        </header>

        {!editing || editStep === "details" ? (
          <>
            <form id={`${mode}-admin-user-form`} className="min-h-0 overflow-y-auto" onSubmit={handleDetailsSubmit} noValidate>
              <fieldset disabled={submitting} className="flex flex-col p-[16px]">
                <div className="grid grid-cols-1 gap-[16px] border-b border-[var(--color-neutral-200)] pb-[16px] sm:grid-cols-2 sm:gap-[24px]">
                  <Input {...textInputProps("fullName")} label="Nombre" placeholder="John Doe" required showLabel showLabelInfo={false} showLeftIcon leftIcon={<User size="20" color="currentColor" />} showRightIcon={false} className="max-w-none" autoComplete="name" />
                  <Input {...textInputProps("companyName")} label="Empresa" placeholder="Next C.A." required={false} showLabel showLabelInfo={false} showLeftIcon leftIcon={<Buildings size="20" color="currentColor" />} showRightIcon={false} showHint={Boolean(errors.companyName)} className="max-w-none" autoComplete="organization" />
                </div>

                <div className="grid grid-cols-1 gap-[16px] border-b border-[var(--color-neutral-200)] py-[16px] sm:grid-cols-2 sm:gap-[24px]">
                  <Input {...textInputProps("email")} label="Email" placeholder="usuario@gmail.com" type="Default input" required showLabel showLabelInfo={false} showLeftIcon leftIcon={<Sms size="20" color="currentColor" />} showRightIcon={false} className="max-w-none" autoComplete="email" inputMode="email" />
                  <SelectField error={errors.roleCode} items={roleItems} label="Rol" selectedItemId={values.roleCode} onSelect={(item) => updateValue("roleCode", item.id)} />
                </div>

                <div className="grid grid-cols-1 gap-[16px] border-b border-[var(--color-neutral-200)] py-[16px] sm:grid-cols-2 sm:gap-[24px]">
                  <Input {...textInputProps("phone")} label="Teléfono" placeholder="(444) 1234-5678" type="Phone number" required={false} showLabel showLabelInfo={false} showLeftIcon={false} showRightIcon={false} showHint hintText={errors.phone || "Le enviaremos un código para la verificación."} className="max-w-none" countryCode={values.phoneCountryCode} countryPrefix={values.phonePrefix} onPhoneCountryChange={(country) => { updateValue("phonePrefix", country.dialCode); updateValue("phoneCountryCode", country.countryCode); }} autoComplete="tel" />
                  <Input {...textInputProps("secondaryPhone")} label="Teléfono" placeholder="(444) 1234-5678" type="Phone number" required={false} showLabel showLabelInfo={false} showLeftIcon={false} showRightIcon={false} showHint hintText={errors.secondaryPhone || "Le enviaremos un código para la verificación."} className="max-w-none" countryCode={values.secondaryPhoneCountryCode} countryPrefix={values.secondaryPhonePrefix} onPhoneCountryChange={(country) => { updateValue("secondaryPhonePrefix", country.dialCode); updateValue("secondaryPhoneCountryCode", country.countryCode); }} autoComplete="tel" />
                </div>

                <div className="grid grid-cols-1 gap-[16px] pt-[16px] sm:grid-cols-2 sm:gap-[24px]">
                  <SelectField error={errors.status} items={STATUS_ITEMS} label="Status" selectedItemId={values.status} onSelect={(item) => updateValue("status", item.id)} />
                </div>

                {submitError ? <p className="mt-[16px] text-body-3 text-[var(--color-danger-100)]" role="alert">{submitError}</p> : null}
              </fieldset>
            </form>

            <footer className="flex flex-col-reverse gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px] sm:flex-row sm:items-center">
              <Button theme="Primary" type="Outline" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full sm:min-w-0 sm:flex-1" onClick={onClose}>Cancelar</Button>
              <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting || roles.length === 0} className="!h-[41px] !w-full sm:min-w-0 sm:flex-1" htmlType="submit" form={`${mode}-admin-user-form`}>{submitting ? (editing ? "Guardando..." : "Creando...") : (editing ? "Siguiente" : "Enviar código de activación")}</Button>
            </footer>
          </>
        ) : (
          <>
            <form id="edit-admin-user-password-form" className="min-h-0 overflow-y-auto" onSubmit={handlePasswordSubmit} noValidate>
              <fieldset disabled={submitting} className="grid grid-cols-1 items-start gap-[16px] p-[16px] sm:grid-cols-2 sm:gap-[24px]">
                <Input
                  label="Cambiar contraseña"
                  type="Password"
                  size="S"
                  value={password}
                  state={passwordState}
                  hintText={passwordError || "Ingresa una nueva contraseña"}
                  showHint
                  showLabelInfo={false}
                  required={false}
                  showPasswordStrength
                  passwordRequirements={PASSWORD_REQUIREMENT_RULES}
                  passwordHintTitle="Debe contener al menos:"
                  className="w-full max-w-none"
                  autoComplete="new-password"
                  onChange={(event) => { setPassword(event.target.value); setPasswordError(""); setSubmitError(""); }}
                  onBlur={() => setPasswordTouched((current) => ({ ...current, password: true }))}
                />
                <Input
                  label="Confirmar contraseña"
                  type="Password"
                  size="S"
                  value={confirmPassword}
                  state={confirmPasswordState}
                  hintText="Las contraseñas no coinciden."
                  showHint={passwordTouched.confirmPassword && !passwordIsEmpty && !passwordsMatch}
                  showLabelInfo={false}
                  required={false}
                  showPasswordStrength={false}
                  className="w-full max-w-none"
                  autoComplete="new-password"
                  onChange={(event) => { setConfirmPassword(event.target.value); setSubmitError(""); }}
                  onBlur={() => setPasswordTouched((current) => ({ ...current, confirmPassword: true }))}
                />
                {submitError ? <p className="text-body-3 text-[var(--color-danger-100)] sm:col-span-2" role="alert">{submitError}</p> : null}
              </fieldset>
            </form>

            <footer className="flex flex-col-reverse gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px] sm:flex-row sm:items-center">
              <Button theme="Primary" type="Outline" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full sm:min-w-0 sm:flex-1" onClick={() => { setSubmitError(""); setEditStep("details"); }}>Anterior</Button>
              <Button theme="Primary" type="Solid" size="M" showLeftIcon={false} showRightIcon={false} disabled={submitting} className="!h-[41px] !w-full sm:min-w-0 sm:flex-1" htmlType="submit" form="edit-admin-user-password-form">{submitting ? "Guardando..." : "Confirmar cambios"}</Button>
            </footer>
          </>
        )}
      </div>
    </Modal>
  );
}

function CreateAdminUserModal(props) {
  return <AdminUserFormModal {...props} mode="create" onSubmit={props.onCreate} />;
}

export { AdminUserFormModal };
export default CreateAdminUserModal;
