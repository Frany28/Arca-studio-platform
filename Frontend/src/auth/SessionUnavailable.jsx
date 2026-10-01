/* Muestra el estado de error temporal cuando no se puede verificar la sesión. */
// Presenta el mensaje y permite volver a intentar la restauración de sesión.
function SessionUnavailable({ onRetry }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-neutral-bg)] px-[16px]">
      <section
        className="flex max-w-[440px] flex-col items-center gap-[16px] text-center"
        role="alert"
        aria-live="polite"
      >
        <h1 className="text-heading-4 text-[var(--color-text-50)]">
          No pudimos verificar tu sesión
        </h1>
        <p className="text-body-3 text-[var(--color-text-200)]">
          Tu información permanece protegida. Comprueba tu conexión e inténtalo
          nuevamente.
        </p>
        <button
          type="button"
          className="rounded-[var(--radius-2)] bg-[var(--color-primary-300)] px-[16px] py-[12px] text-body-3 text-[var(--color-neutral-100-uniform)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-10)]"
          onClick={onRetry}
        >
          Reintentar
        </button>
      </section>
    </main>
  );
}

export default SessionUnavailable;
