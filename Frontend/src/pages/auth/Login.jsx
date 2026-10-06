import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth/AuthContext.jsx";
import { getDefaultAuthenticatedPath } from "../../auth/authRoutes.js";
import group1Logo from "../../assets/logos/Group 1.svg";
import AuthLayout from "../../components/layout/AuthLayout.jsx";
import Button from "../../components/ui/Button/Button.jsx";
import AuthToast, {
  AuthToastLockIcon,
} from "../../components/ui/AuthToast/AuthToast.jsx";
import Input from "../../components/ui/Input/Input.jsx";

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

// Credenciales públicas y desechables de la cuenta de staging/demo.
// Deben retirarse antes de que ARCA Studio pase a producción.
const DEMO_EMAIL = "admin2026@arcastudio.com";
const DEMO_PASSWORD = "Admin2026*";

function Login() {
  const location = useLocation();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loginToast, setLoginToast] = useState(null);
  const [touched, setTouched] = useState({
    email: false,
    password: false,
  });

  const emailHasError = touched.email && !isValidEmail(email);
  const passwordHasError =
    touched.password && (password.trim().length < 8 || Boolean(authError));

  const emailState = useMemo(() => {
    if (emailHasError) {
      return "Error";
    }

    return email.trim() ? "Filled" : "Default";
  }, [email, emailHasError]);

  const passwordState = useMemo(() => {
    if (passwordHasError) {
      return "Error";
    }

    return password.trim() ? "Filled" : "Default";
  }, [password, passwordHasError]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");

    setTouched({
      email: true,
      password: true,
    });

    if (!isValidEmail(email) || password.trim().length < 8) {
      return;
    }

    setIsSubmitting(true);

    try {
      const user = await login({ email, password });
      const fallbackPath = getDefaultAuthenticatedPath(user);
      const redirectTo = location.state?.from?.pathname || fallbackPath;

      navigate(redirectTo, {
        replace: true,
      });
    } catch (error) {
      if (error?.code === "ACCOUNT_NOT_ACTIVE") {
        navigate("/cuenta-inactiva", {
          replace: true,
        });
        return;
      }

      if (error?.code === "AUTH_SESSION_MISSING") {
        setAuthError(
          "El backend desplegado debe actualizarse para enviar la sesión.",
        );
      } else {
        console.error(error);
      }

      setTouched({
        email: true,
        password: true,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const showEmailHint = touched.email && emailHasError;
  const showPasswordHint = touched.password && passwordHasError;
  const authToast = location.state?.authToast;

  useEffect(() => {
    if (!authToast) {
      return;
    }

    setLoginToast(authToast);

    navigate(location.pathname, {
      replace: true,
      state: {},
    });
  }, [authToast, location.pathname, navigate]);

  return (
    <AuthLayout>
      <AuthToast
        trigger={loginToast?.id ?? null}
        title={loginToast?.title ?? ""}
        description={loginToast?.description ?? ""}
        startDelayMs={320}
        autoHideMs={6200}
        leading={
          loginToast?.icon === "lock" ? <AuthToastLockIcon /> : undefined
        }
      />
      <section className="flex w-full max-w-[581px] items-center rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)] lg:min-h-[544px]">
        <div className="flex w-full flex-col items-start justify-center gap-[16px] p-[24px] sm:p-[40px] lg:p-[56px]">
          <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
            <div className="flex w-full flex-col items-start gap-2 border-b border-[var(--color-neutral-200)] pb-4">
              <img
                src={group1Logo}
                alt="ARCA Studio"
                className="h-12 w-[50.64px] object-contain"
              />
              <h1 className="text-heading-3 m-0 self-stretch text-[var(--color-text-300)] max-sm:text-[40px] max-sm:leading-[46px]">
                Accede a tu cuenta
              </h1>
            </div>

            <Input
              label="Correo Electrónico"
              type="Default input"
              size="S"
              value={email}
              state={emailState}
              placeholder="ejemplo@dominio.com"
              showHint={showEmailHint}
              hintText="Este correo no se encuentra."
              showLabelInfo={false}
              required={false}
              showRightIcon={false}
              className="max-w-none w-full"
              onChange={(event) => setEmail(event.target.value)}
            />

            <Input
              label="Contraseña"
              type="Password"
              size="S"
              value={password}
              state={passwordState}
              showHint={showPasswordHint}
              hintText="Contraseña incorrecta."
              showLabelInfo={false}
              required={false}
              showPasswordStrength={false}
              className="max-w-none w-full"
              onChange={(event) => setPassword(event.target.value)}
            />

            {authError ? (
              <p className="text-body-4 text-[var(--color-danger-100)]">
                {authError}
              </p>
            ) : null}


            <div className="w-full">
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
                Iniciar sesión
              </Button>
            </div>

            <div className="flex w-full flex-col items-center gap-[4px]">
              <Button
                theme="Primary"
                type="Ghost"
                size="M"
                fitContent={false}
                showLeftIcon={false}
                showRightIcon={false}
                className="h-[41px] w-full !bg-transparent !text-[var(--color-text-300)] hover:!bg-transparent hover:!text-[var(--color-text-50)]"
                onClick={() => navigate("/recuperar-cuenta")}
              >
                Olvidé mi contraseña
              </Button>
              <Button
                theme="Primary"
                type="Ghost"
                size="M"
                fitContent={false}
                showLeftIcon={false}
                showRightIcon={false}
                className="h-[41px] w-full !bg-transparent !text-[var(--color-text-300)] hover:!bg-transparent hover:!text-[var(--color-text-50)]"
                onClick={() => navigate("/crear-cuenta")}
              >
                Registrarse
              </Button>
            </div>
          </form>
        </div>
      </section>
    </AuthLayout>
  );
}

export default Login;
