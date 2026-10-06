import { useMemo, useState } from "react";

import { api } from "../../api/http.js";
import group1Logo from "../../assets/logos/Group 1.svg";
import AuthLayout from "../../components/layout/AuthLayout.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import AuthToast, {
  AuthToastMailIcon,
} from "../../components/ui/AuthToast/AuthToast.jsx";
import Input from "../../components/ui/Input/Input.jsx";

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

function RecoverAccount() {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [toastTrigger, setToastTrigger] = useState(null);

  const emailHasError =
    (touched && !isValidEmail(email)) || Boolean(submitError);
  const emailState = useMemo(() => {
    if (emailHasError) {
      return "Error";
    }

    return email.trim() ? "Filled" : "Default";
  }, [email, emailHasError]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched(true);
    setSubmitError("");

    if (!isValidEmail(email)) {
      return;
    }

    setIsSubmitting(true);

    try {
      await api.auth.requestPasswordReset({ email });
      setToastTrigger(Date.now());
    } catch (error) {
      if (error.code === "EMAIL_NOT_FOUND") {
        setSubmitError("No encontramos una cuenta asociada a ese correo.");
        return;
      }

      if (error.code === "ACCOUNT_NOT_ACTIVE") {
        setSubmitError("La cuenta no esta activa. Contacta a soporte.");
        return;
      }

      setSubmitError("No pudimos enviar el enlace. Intentalo de nuevo.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <AuthToast
        trigger={toastTrigger}
        title="Enlace enviado"
        description="Hemos enviado un enlace a tu correo electronico."
        leading={<AuthToastMailIcon />}
      />

      <section className="flex w-full max-w-[581px] items-center gap-[var(--spacing-gap-0)] rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)]">
        <div className="flex w-full flex-col items-start justify-center gap-[16px] p-[24px] sm:p-[40px] lg:p-[56px]">
          <form
            onSubmit={handleSubmit}
            className="flex w-full flex-col gap-[16px]"
          >
            <div className="flex w-full flex-col items-start gap-[8px] border-b border-[var(--color-neutral-200)] pb-[16px]">
              <img
                src={group1Logo}
                alt="ARCA Studio"
                className="h-[48px] w-[50.64px] object-contain"
              />
              <h1
                className="m-0 font-bold text-(--color-text-300)"
                style={{
                  whiteSpace: "nowrap",
                  fontSize: "clamp(30px, 4.5vw, 42px)",
                  lineHeight: 1.05,
                }}
              >
                Recupera tu acceso
              </h1>
            </div>

            <Input
              label="Correo electronico"
              type="Default input"
              size="S"
              value={email}
              state={emailState}
              placeholder="ejemplo@dominio.com"
              hintText={
                submitError ||
                (emailHasError
                  ? "Ingresa un correo electronico valido."
                  : "Te enviaremos un enlace para restablecer tu contraseña")
              }
              showHint
              showLabelInfo={false}
              required={false}
              showRightIcon={false}
              className="w-full max-w-none"
              onChange={(event) => {
                setEmail(event.target.value);
                setSubmitError("");
              }}
            />

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
              {isSubmitting ? "Enviando..." : "Enviar enlace"}
            </Button>
          </form>
        </div>
      </section>
    </AuthLayout>
  );
}

export default RecoverAccount;
