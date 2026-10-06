import { useNavigate } from "react-router-dom";

import group1Logo from "../../assets/logos/Group 1.svg";
import AuthLayout from "../../components/layout/AuthLayout.jsx";
import Button from "../../components/ui/Button/Button.jsx";

function InactiveAccount() {
  const navigate = useNavigate();

  return (
    <AuthLayout>
      <section className="flex w-full max-w-[688px] items-center rounded-[var(--radius-4)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] p-[16px] shadow-[var(--shadow-e2)]">
        <div className="flex w-full flex-col items-start justify-center gap-[16px] p-[24px] sm:p-[40px] lg:p-[56px]">
          <div className="flex w-full flex-col items-start gap-[8px] border-b border-[var(--color-neutral-200)] pb-[16px]">
            <img
              src={group1Logo}
              alt="ARCA Studio"
              className="h-[48px] w-[50.64px] object-contain"
            />
            <h1 className="text-heading-3 m-0 text-[var(--color-text-300)] max-sm:text-[40px] max-sm:leading-[46px]">
              Tu cuenta esta inactiva
            </h1>
          </div>

          <div className="flex w-full flex-col gap-[4px] text-[var(--color-text-300)]">
            <p className="text-heading-6 m-0">
              En este momento no tienes acceso a la plataforma.
            </p>
            <p className="text-body-2 m-0">
              Si necesitas activar tu cuenta, por favor contacta con nuestro
              equipo.
            </p>
          </div>

          <div className="flex w-full flex-col gap-[8px] sm:flex-row">
            <Button
              theme="Primary"
              type="Outline"
              size="M"
              fitContent={false}
              showLeftIcon={false}
              showRightIcon={false}
              className="w-full sm:flex-1"
            >
              Contactar con soporte
            </Button>

            <Button
              theme="Primary"
              type="Solid"
              size="M"
              fitContent={false}
              showLeftIcon={false}
              showRightIcon={false}
              className="w-full sm:flex-1"
              onClick={() => navigate("/")}
            >
              Volver a Inicio
            </Button>
          </div>
        </div>
      </section>
    </AuthLayout>
  );
}

export default InactiveAccount;
