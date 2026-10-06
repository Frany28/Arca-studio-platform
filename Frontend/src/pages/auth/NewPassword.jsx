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

function getPasswordState(value, touched) {
  if (!touched) {
    return value.trim() ? "Filled" : "Default";
  }

  return PASSWORD_REQUIREMENTS.every((requirement) => requirement.test(value))
    ? "Filled"
    : "Error";
}

function NewPassword() {
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
      setValidationError(
        "No se encontró un enlace válido para recuperar la contraseña.",
      );
      setIsTokenValid(false);
      setIsValidatingToken(false);
      return;
    }

    let active = true;
    setValidationError("");
    setIsValidatingToken(true);

    api.auth
      .verifyResetToken({ token })
      .then(() => {
        if (!active) return;
        setIsTokenValid(true);
      })
      .catch((error) => {
        if (!active) return;
        setIsTokenValid(false);
        setValidationError(
          error?.message || "El enlace de recuperación no es válido o expiró.",
        );
      })
      .finally(() => {
        if (!active) return;
        setIsValidatingToken(false);
      });

    return () => {
      active = false;
    };
  }, [token]);

  const passwordState = useMemo(
    () => getPasswordState(password, touched.password),
    [password, touched.password],
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
  const passwordIsValid = PASSWORD_REQUIREMENTS.every((requirement) =>
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
      await api.auth.resetPassword({ token, password });
      try {
        window.localStorage.setItem("arca_auth_logout", Date.now().toString());
      } catch {
        // Ignore storage errors in restricted browser contexts.
      }

      navigate("/", {
        state: {
          authToast: {
            id: Date.now(),
            title: "Contraseña restablecida",
            description:
              "Tu contraseña ha sido actualizada con éxito. Por razones de seguridad, por favor verifica la actividad reciente.",
            icon: "lock",
          },
        },
      });
    } catch (error) {
      setFormError(
        error?.message ||
          "No se pudo restablecer la contraseña. Intenta nuevamente.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isValidatingToken && validationError) {
    return (
      <AuthLayout>
        <ExpiredLinkCard
          description="Por motivos de seguridad, el enlace para restablecer tu contraseña ya no es válido."
          onReturnToLogin={() => navigate("/")}
          onRequestNewLink={() => navigate("/recuperar-cuenta")}
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
                Recupera tu acceso
              </h1>
            </div>

            {(validationError || isValidatingToken) && (
              <div className="w-full rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-white p-[16px] text-[var(--color-text-300)]">
                <p className="m-0 text-sm text-[var(--color-text-300)]">
                  {isValidatingToken
                    ? "Validando enlace de recuperación..."
                    : validationError}
                </p>
                {!isValidatingToken && validationError && (
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
              hintText="Ingresa una nueva contraseña"
              showHint
              showLabelInfo={false}
              required={false}
              showPasswordStrength
              passwordRequirements={PASSWORD_REQUIREMENTS}
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
              {submitting
                ? "Actualizando contraseña..."
                : "Actualizar contraseña"}
            </Button>
          </form>
        </div>
      </section>
    </AuthLayout>
  );
}

export default NewPassword;
