import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Buildings, Sms, User } from "iconsax-react";

import group1Logo from "../../assets/logos/Group 1.svg";
import { api } from "../../api/http.js";
import AuthLayout from "../../components/layout/AuthLayout.jsx";
import AuthToast, { AuthToastMailIcon } from "../../components/ui/AuthToast/AuthToast.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import HorizontalTabMenu from "../../components/ui/HorizontalTabMenu/HorizontalTabMenu.jsx";
import Input from "../../components/ui/Input/Input.jsx";

const referralItems = ["Instagram", "Referido", "WhatsApp", "Otro"];
const referralValues = ["instagram", "referred", "whatsapp", "other"];

function FieldIcon({ icon }) {
  const ResolvedIcon = icon;
  return (
    <ResolvedIcon
      size="20"
      variant="Linear"
      color="currentColor"
      className="size-5"
      aria-hidden="true"
    />
  );
}

function getInputState(value) {
  return String(value ?? "").trim() ? "Filled" : "Default";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function hasValidPhone(value) {
  let digits = String(value).replace(/\D/g, "");
  if (digits.startsWith("58")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.length === 10;
}

function getCreateAccountErrors({ email, fullName, phone }) {
  const errors = {};
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);

  if (nameParts.length < 2) {
    errors["body.fullName"] = "Ingresa tu nombre y apellido.";
  }
  if (!isValidEmail(email)) {
    errors.email = "Ingresa un correo electrónico válido.";
  }
  if (!hasValidPhone(phone)) {
    errors.phone = "Ingresa un número de teléfono válido.";
  }

  return errors;
}

function CreateAccount() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [referralIndex, setReferralIndex] = useState(0);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [toast, setToast] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const validationErrors = getCreateAccountErrors({
      email,
      fullName,
      phone,
    });

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setToast({
        id: Date.now(),
        title: "Revisa tus datos",
        description: "Completa correctamente los campos obligatorios.",
      });
      return;
    }
    setIsSubmitting(true);
    setFieldErrors({});
    try {
      await api.auth.startRegistration({
        fullName,
        email,
        company,
        phone,
        referralSource: referralValues[referralIndex],
      });
      setShowEmailVerification(true);
    } catch (error) {
      const errors = { ...(error.fields || {}) };
      if (error.code === "EMAIL_ALREADY_EXISTS") errors.email = error.message;
      if (error.code === "PHONE_ALREADY_EXISTS") errors.phone = error.message;
      setFieldErrors(errors);
      setToast({ id: Date.now(), title: "No pudimos continuar", description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    try {
      const result = await api.auth.resendRegistration({ email });
      setToast({ id: Date.now(), title: "Correo reenviado", description: result.message });
    } catch (error) {
      setToast({ id: Date.now(), title: "No pudimos reenviar", description: error.message });
    } finally {
      setIsResending(false);
    }
  };

  if (showEmailVerification) {
    return (
      <AuthLayout>
        <AuthToast trigger={toast?.id} title={toast?.title || ""} description={toast?.description || ""} leading={<AuthToastMailIcon />} />
        <section className="box-border flex w-full max-w-[579px] shrink-0 items-center rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)]">
          <div className="flex w-full flex-col items-start justify-center gap-[16px] p-[24px] sm:p-[40px] lg:p-[56px]">
            <div className="flex w-full flex-col items-start gap-[8px] border-b border-[var(--color-neutral-200)] pb-[16px]">
              <img
                src={group1Logo}
                alt="ARCA Studio"
                className="h-[48px] w-[50.64px] object-contain"
              />
              <h1 className="text-heading-3 m-0 text-[var(--color-text-300)] max-sm:text-[40px] max-sm:leading-[46px]">
                Verifica tu correo electrónico
              </h1>
            </div>

            <div className="flex w-full flex-col items-start gap-[4px] text-[var(--color-text-300)]">
              <p className="text-heading-6 m-0">
                Antes de continuar, necesitamos confirmar tu dirección de
                correo electrónico.
              </p>
              <p className="text-body-2 m-0">
                Hemos enviado un enlace de verificación a tu bandeja de
                entrada. Una vez confirmado, podrás crear tu contraseña y
                acceder a tu cuenta.
              </p>
            </div>

            <div className="flex w-full flex-col gap-[8px] sm:flex-row">
              <Button
                theme="Primary"
                type="Outline"
                size="L"
                fitContent={false}
                showLeftIcon={false}
                showRightIcon={false}
                className="w-full sm:flex-1"
                disabled={isResending}
                onClick={handleResend}
              >
                {isResending ? "Reenviando..." : "Reenviar correo"}
              </Button>
              <Button
                theme="Primary"
                type="Solid"
                size="L"
                fitContent={false}
                showLeftIcon={false}
                showRightIcon={false}
                className="w-full sm:flex-1"
                onClick={() => navigate("/")}
              >
                Entendido
              </Button>
            </div>

            <p className="text-body-2 m-0 w-full text-center text-[var(--color-text-200)]">
              ¿No encuentras el correo? Revisa tu carpeta de spam o solicita
              un nuevo enlace.
            </p>
          </div>
        </section>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthToast trigger={toast?.id} title={toast?.title || ""} description={toast?.description || ""} />
      <section className="box-border flex w-full max-w-[579px] shrink-0 items-center rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)]">
        <div className="flex w-full flex-col items-start justify-center gap-[16px] p-[24px] sm:p-[40px] lg:p-[56px]">
          <form noValidate onSubmit={handleSubmit} className="flex w-full flex-col gap-[16px]">
            <div className="flex w-full flex-col items-start gap-[8px] border-b border-[var(--color-neutral-200)] pb-[16px]">
              <img
                src={group1Logo}
                alt="ARCA Studio"
                className="h-[48px] w-[50.64px] object-contain"
              />
              <h1 className="text-heading-3 m-0 self-stretch text-[var(--color-text-300)] max-sm:text-[40px] max-sm:leading-[46px]">
                Crear cuenta
              </h1>
            </div>

            <Input
              label="Nombre Completo"
              type="Default input"
              size="S"
              value={fullName}
              state={fieldErrors["body.fullName"] ? "Error" : getInputState(fullName)}
              placeholder="Escribe tu nombre y apellido"
              showHint={Boolean(fieldErrors["body.fullName"])}
              hintText={fieldErrors["body.fullName"]}
              showLabelInfo={false}
              required
              showRightIcon={false}
              leftIcon={<FieldIcon icon={User} />}
              className="w-full max-w-none"
              onChange={(event) => {
                setFullName(event.target.value);
                setFieldErrors((current) => ({
                  ...current,
                  "body.fullName": undefined,
                }));
              }}
            />

            <Input
              label="Correo Electrónico"
              type="Default input"
              size="S"
              value={email}
              state={fieldErrors.email || fieldErrors["body.email"] ? "Error" : getInputState(email)}
              placeholder="ejemplo@dominio.com"
              showHint={Boolean(fieldErrors.email || fieldErrors["body.email"])}
              hintText={fieldErrors.email || fieldErrors["body.email"]}
              showLabelInfo={false}
              required
              showRightIcon={false}
              leftIcon={<FieldIcon icon={Sms} />}
              className="w-full max-w-none"
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldErrors((current) => ({
                  ...current,
                  email: undefined,
                  "body.email": undefined,
                }));
              }}
            />

            <Input
              label="Empresa (opcional)"
              type="Default input"
              size="S"
              value={company}
              state={getInputState(company)}
              placeholder="Nombre de la empresa"
              showHint={false}
              showLabelInfo={false}
              required={false}
              showRightIcon={false}
              leftIcon={<FieldIcon icon={Buildings} />}
              className="w-full max-w-none"
              onChange={(event) => setCompany(event.target.value)}
            />

            <Input
              label="Número de teléfono"
              type="Phone number"
              size="S"
              value={phone}
              state={fieldErrors.phone || fieldErrors["body.phone"] ? "Error" : getInputState(phone)}
              placeholder="(414) 1234-5678"
              countryCode="VE"
              countryPrefix="+58"
              showHint={Boolean(fieldErrors.phone || fieldErrors["body.phone"])}
              hintText={fieldErrors.phone || fieldErrors["body.phone"]}
              showLabelInfo={false}
              required
              showRightIcon={false}
              className="w-full max-w-none"
              onChange={(event) => {
                setPhone(event.target.value);
                setFieldErrors((current) => ({
                  ...current,
                  phone: undefined,
                  "body.phone": undefined,
                }));
              }}
            />

            <div className="flex w-full flex-col items-start gap-[8px]">
              <p className="text-heading-8 m-0 text-[var(--color-text-300)]">
                ¿Cómo nos conoció?
              </p>
              <HorizontalTabMenu
                items={referralItems}
                activeIndex={referralIndex}
                interactive
                filled="off"
                style="Brand"
                aria-label="Cómo nos conoció"
                onChange={setReferralIndex}
              />
            </div>

            <Button
              htmlType="submit"
              theme="Primary"
              type="Solid"
              size="M"
              fitContent={false}
              showLeftIcon={false}
              showRightIcon={false}
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Enviando..." : "Continuar"}
            </Button>

            <Button
              theme="Primary"
              type="Ghost"
              size="M"
              fitContent={false}
              showLeftIcon={false}
              showRightIcon={false}
              className="h-[41px] w-full !bg-transparent !text-[var(--color-text-300)] hover:!bg-transparent hover:!text-[var(--color-text-50)]"
              onClick={() => navigate("/")}
            >
              Ya tengo una cuenta
            </Button>
          </form>
        </div>
      </section>
    </AuthLayout>
  );
}

export default CreateAccount;
