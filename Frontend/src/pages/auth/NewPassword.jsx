import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../../api/http.js";
import group1Logo from "../../assets/logos/Group 1.svg";
import AuthLayout from "../../components/layout/AuthLayout.jsx";
import ExpiredLinkCard from "../../components/ExpiredLinkCard.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import Input from "../../components/ui/Input/Input.jsx";

const PASSWORD_REQUIREMENTS = [
  {
    label: "Al menos 1 mayúscula",
    test: (value) => /[A-Z]/.test(value),
  },
  {
    label: "Al menos 1 número",
    test: (value) => /\d/.test(value),
  },
  {
    label: "Al menos 1 carácter especial",
    test: (value) => /[^A-Za-z0-9]/.test(value),
  },
  {
    label: "Al menos 8 caracteres",
    test: (value) => String(value).trim().length >= 8,
  },
];

// La activación guarda la contraseña con bcrypt, que procesa como máximo 72 caracteres.
const ACTIVATION_PASSWORD_REQUIREMENTS = [
  ...PASSWORD_REQUIREMENTS,
  { label: "Máximo 72 caracteres", test: (value) => String(value).length <= 72 },
];

// Textos y llamadas de cada uso de la página: recuperar la contraseña o activar una cuenta pendiente
// (cliente creado desde una cotización). Ambos usan un enlace de un solo uso enviado al correo.
const VARIANTS = {
  activation: {
    complete: ({ password, token }) => api.auth.completeActivation({ password, token }),
    expiredDescription: "Por motivos de seguridad, el enlace para activar tu cuenta ya no es válido o ya se usó.",
    expiredHint: "Pide a ARCA Studio que te envíe un nuevo enlace de activación.",
    invalidMessage: "El enlace de activación no es válido o expiró.",
    missingMessage: "No se encontró un enlace válido para activar la cuenta.",
    passwordHint: "Crea la contraseña de tu cuenta",
    requirements: ACTIVATION_PASSWORD_REQUIREMENTS,
    submitLabel: "Activar cuenta",
    submittingLabel: "Activando cuenta...",
    submitError: "No se pudo activar la cuenta. Intenta nuevamente.",
    title: "Activa tu cuenta",
    toast: {
      description: "Tu correo quedó confirmado y tu cuenta está activa. Ya puedes iniciar sesión con tu nueva contraseña.",
      icon: "lock",
      title: "Cuenta activada",
    },
    validating: "Validando enlace de activación...",
    verify: ({ token }) => api.auth.verifyActivationToken({ token }),
  },
  reset: {
    complete: ({ password, token }) => api.auth.resetPassword({ password, token }),
    expiredDescription: "Por motivos de seguridad, el enlace para restablecer tu contraseña ya no es válido.",
    invalidMessage: "El enlace de recuperación no es válido o expiró.",
    missingMessage: "No se encontró un enlace válido para recuperar la contraseña.",
    passwordHint: "Ingresa una nueva contraseña",
    requestNewLinkPath: "/recuperar-cuenta",
    requirements: PASSWORD_REQUIREMENTS,
    submitLabel: "Actualizar contraseña",
    submittingLabel: "Actualizando contraseña...",
    submitError: "No se pudo restablecer la contraseña. Intenta nuevamente.",
    title: "Recupera tu acceso",
    toast: {
      description: "Tu contraseña ha sido actualizada con éxito. Por razones de seguridad, por favor verifica la actividad reciente.",
      icon: "lock",
      title: "Contraseña restablecida",
    },
    validating: "Validando enlace de recuperación...",
    verify: ({ token }) => api.auth.verifyResetToken({ token }),
  },
};

function getPasswordState(value, touched, requirements) {
  if (!touched) {
    return value.trim() ? "Filled" : "Default";
  }

  return requirements.every((requirement) => requirement.test(value))
    ? "Filled"
    : "Error";
}

/**
 * Define una contraseña desde un enlace de un solo uso: restablecer (`reset`, por defecto) o activar
 * una cuenta pendiente (`activation`). Valida el enlace al abrir la página y no inicia sesión.
 *
 * @param {{variant?: "reset"|"activation"}} props - Uso de la página.
 * @returns {import("react").ReactElement} Página.
 */
function NewPassword({ variant = "reset" }) {
  const copy = VARIANTS[variant] || VARIANTS.reset;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState({
    password: false,
    confirmPassword: false,
  });
  const [isTokenValid, setIsTokenValid] = useState(false);
  const [isValidatingToken, setIsValidatingToken] = useState(true);
  const [validationError, setValidationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!token) {
      setValidationError(copy.missingMessage);
      setIsTokenValid(false);
      setIsValidatingToken(false);
      return;
    }

    let active = true;
    setValidationError("");
    setIsValidatingToken(true);

    copy
      .verify({ token })
      .then(() => {
        if (!active) return;
        setIsTokenValid(true);
      })
      .catch((error) => {
        if (!active) return;
        setIsTokenValid(false);
        setValidationError(error?.message || copy.invalidMessage);
      })
      .finally(() => {
        if (!active) return;
        setIsValidatingToken(false);
      });

    return () => {
      active = false;
    };
  }, [copy, token]);

  const passwordState = useMemo(
    () => getPasswordState(password, touched.password, copy.requirements),
    [copy.requirements, password, touched.password],
  );

  const confirmPasswordState = useMemo(() => {
    if (!touched.confirmPassword) {
      return confirmPassword.trim() ? "Filled" : "Default";
    }

    if (confirmPassword.trim() && confirmPassword === password) {
      return "Filled";
    }

    return "Error";
  }, [confirmPassword, password, touched.confirmPassword]);

  const showConfirmHint =
    touched.confirmPassword &&
    confirmPassword.trim().length > 0 &&
    confirmPassword !== password;
  const passwordIsValid = copy.requirements.every((requirement) =>
    requirement.test(password),
  );
  const passwordsMatch =
    confirmPassword.trim().length > 0 && confirmPassword === password;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched({
      password: true,
      confirmPassword: true,
    });

    if (!passwordIsValid || !passwordsMatch || !isTokenValid) {
      return;
    }

    setFormError("");
    setSubmitting(true);

    try {
      await copy.complete({ password, token });
      try {
        window.localStorage.setItem("arca_auth_logout", Date.now().toString());
      } catch {
        // Ignore storage errors in restricted browser contexts.
      }

      navigate("/", {
        state: {
          authToast: { ...copy.toast, id: Date.now() },
        },
      });
    } catch (error) {
      setFormError(error?.message || copy.submitError);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isValidatingToken && validationError) {
    return (
      <AuthLayout>
        <ExpiredLinkCard
          description={copy.expiredDescription}
          onReturnToLogin={() => navigate("/")}
          onRequestNewLink={copy.requestNewLinkPath ? () => navigate(copy.requestNewLinkPath) : undefined}
          {...(copy.expiredHint ? { requestHint: copy.expiredHint } : {})}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <section className="flex w-full max-w-[581px] items-center rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)]">
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
                {copy.title}
              </h1>
            </div>

            {(validationError || isValidatingToken) && (
              <div className="w-full rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-white p-[16px] text-[var(--color-text-300)]">
                <p className="m-0 text-sm text-[var(--color-text-300)]">
                  {isValidatingToken
                    ? copy.validating
                    : validationError}
                </p>
                {!isValidatingToken && validationError && copy.requestNewLinkPath && (
                  <p className="mt-[8px] text-sm">
                    <a
                      href="/recuperar-cuenta"
                      className="text-[var(--color-primary-600)] hover:underline"
                    >
                      Solicitar otro enlace de recuperación
                    </a>
                  </p>
                )}
              </div>
            )}

            <Input
              label="Nueva contraseña"
              type="Password"
              size="S"
              value={password}
              state={passwordState}
              hintText={copy.passwordHint}
              showHint
              showLabelInfo={false}
              required={false}
              showPasswordStrength
              passwordRequirements={copy.requirements}
              passwordHintTitle="Debe contener al menos:"
              className="w-full max-w-none"
              onChange={(event) => setPassword(event.target.value)}
              onBlur={() =>
                setTouched((current) => ({
                  ...current,
                  password: true,
                }))
              }
            />

            <Input
              label="Confirmar contraseña"
              type="Password"
              size="S"
              value={confirmPassword}
              state={confirmPasswordState}
              showHint={showConfirmHint}
              hintText="Las contraseñas no coinciden."
              showLabelInfo={false}
              required={false}
              showPasswordStrength={false}
              className="w-full max-w-none"
              onChange={(event) => setConfirmPassword(event.target.value)}
              onBlur={() =>
                setTouched((current) => ({
                  ...current,
                  confirmPassword: true,
                }))
              }
            />

            {formError ? (
              <div className="rounded-[var(--radius-4)] border border-red-300 bg-[#fff1f0] p-[12px] text-sm text-[#9a1f1f]">
                {formError}
              </div>
            ) : null}

            <Button
              htmlType="submit"
              theme="Primary"
              type="Solid"
              size="M"
              fitContent={false}
              showLeftIcon={false}
              showRightIcon={false}
              className="w-full"
              disabled={
                submitting ||
                isValidatingToken ||
                !isTokenValid ||
                !passwordIsValid ||
                !passwordsMatch
              }
            >
              {submitting ? copy.submittingLabel : copy.submitLabel}
            </Button>
          </form>
        </div>
      </section>
    </AuthLayout>
  );
}

export default NewPassword;
