import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { api } from "../../api/http.js";
import { useAuth } from "../../auth/AuthContext.jsx";
import group1Logo from "../../assets/logos/Group 1.svg";
import AuthLayout from "../../components/layout/AuthLayout.jsx";
import ExpiredLinkCard from "../../components/ExpiredLinkCard.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import Input from "../../components/ui/Input/Input.jsx";
import { PASSWORD_REQUIREMENT_RULES } from "../../components/ui/Input/inputConfig.js";

function getPasswordState(value, touched) {
  if (!touched) {
    return value.trim() ? "Filled" : "Default";
  }

  return PASSWORD_REQUIREMENT_RULES.every((requirement) =>
    requirement.test(value),
  )
    ? "Filled"
    : "Error";
}

function CreatePassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") || "";
  const { completeRegistration } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState({
    password: false,
    confirmPassword: false,
  });
  const [tokenState, setTokenState] = useState("loading");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let active = true;
    if (!token) {
      setTokenState("error");
      return undefined;
    }
    api.auth.verifyRegistration({ token })
      .then(() => { if (active) setTokenState("valid"); })
      .catch(() => {
        if (!active) return;
        setTokenState("error");
      });
    return () => { active = false; };
  }, [token]);

  const passwordIsValid = PASSWORD_REQUIREMENT_RULES.every((requirement) =>
    requirement.test(password),
  );
  const passwordsMatch =
    Boolean(confirmPassword) && confirmPassword === password;

  const passwordState = useMemo(
    () => getPasswordState(password, touched.password),
    [password, touched.password],
  );

  const confirmPasswordState = useMemo(() => {
    if (!touched.confirmPassword) {
      return confirmPassword ? "Filled" : "Default";
    }

    return passwordsMatch ? "Filled" : "Error";
  }, [confirmPassword, passwordsMatch, touched.confirmPassword]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setTouched({ password: true, confirmPassword: true });

    if (!passwordIsValid || !passwordsMatch || tokenState !== "valid") {
      return;
    }
    setIsSubmitting(true);
    setFormError("");
    try {
      await completeRegistration({ token, password, passwordConfirmation: confirmPassword });
      navigate("/dashboard-clientes", { replace: true, state: { registrationComplete: true } });
    } catch (error) {
      setFormError(error.message);
      if (error.code === "INVALID_REGISTRATION_TOKEN") {
        setTokenState("error");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (tokenState === "error") {
    return (
      <AuthLayout>
        <ExpiredLinkCard
          description="Por motivos de seguridad, el enlace para crear tu cuenta ya no es válido."
          onReturnToLogin={() => navigate("/")}
          onRequestNewLink={() => navigate("/crear-cuenta")}
        />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <section className="box-border flex w-full max-w-[579px] shrink-0 items-center rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)]">
        <div className="flex w-full flex-col items-start justify-center gap-[16px] p-[24px] sm:p-[40px] lg:p-[56px]">
          <form noValidate onSubmit={handleSubmit} className="flex w-full flex-col gap-[16px]">
            <div className="flex w-full flex-col items-start gap-[8px] border-b border-[var(--color-neutral-200)] pb-[16px]">
              <img
                src={group1Logo}
                alt="ARCA Studio"
                className="h-[48px] w-[50.64px] object-contain"
              />
              <h1 className="text-heading-3 m-0 text-[var(--color-text-300)] max-sm:text-[40px] max-sm:leading-[46px]">
                Crear cuenta
              </h1>
            </div>

            {tokenState === "loading" ? (
              <div className="rounded-[var(--radius-2)] border border-[var(--color-neutral-200)] p-[16px] text-body-3 text-[var(--color-text-300)]">
                <p className="m-0">Validando enlace...</p>
              </div>
            ) : null}

            <Input
              label="Crear contraseña"
              type="Password"
              size="M"
              value={password}
              state={passwordState}
              hintText="Ingresa una contraseña"
              showHint
              showLabelInfo={false}
              required
              showPasswordStrength
              passwordRequirements={PASSWORD_REQUIREMENT_RULES}
              passwordHintTitle="Debe contener al menos:"
              className="w-full max-w-none"
              onChange={(event) => setPassword(event.target.value)}
              onBlur={() =>
                setTouched((current) => ({ ...current, password: true }))
              }
            />

            <Input
              label="Confirmar contraseña"
              type="Password"
              size="M"
              value={confirmPassword}
              state={confirmPasswordState}
              hintText="Las contraseñas no coinciden."
              showHint={touched.confirmPassword && !passwordsMatch}
              showLabelInfo={false}
              required
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

            <Button
              htmlType="submit"
              theme="Primary"
              type="Solid"
              size="L"
              fitContent={false}
              showLeftIcon={false}
              showRightIcon={false}
              className="w-full"
              disabled={isSubmitting || tokenState !== "valid"}
            >
              {isSubmitting ? "Creando cuenta..." : "Registrarse"}
            </Button>

            {formError ? <p className="text-body-4 m-0 text-[var(--color-danger-100)]">{formError}</p> : null}

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

export default CreatePassword;
