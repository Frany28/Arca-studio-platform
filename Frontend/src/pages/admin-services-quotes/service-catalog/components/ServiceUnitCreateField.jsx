import Button from "../../../../components/ui/Button/Button.jsx";
import Input from "../../../../components/ui/Input/Input.jsx";

/**
 * Fila «Nombre de la unidad» que despliega «+ Crear unidad» dentro del modal de servicios (Figma
 * 5767:342334, anotación «al darle clic a crear unidad se despliega este input»): abreviatura de la
 * unidad base y texto en un Input «Prefix select», con «Guardar» a la derecha. Ocupa su propio
 * espacio en el flujo del formulario (no flota). Solo presenta: el estado y el envío los lleva
 * useInlineDenominationCreator.
 *
 * Teclado: Enter guarda la unidad (no envía el servicio, porque la fila vive dentro de su
 * formulario) y Escape cierra solo esta fila: se detiene aquí para que el diálogo no se cierre.
 * Figma no dibuja un cancelar; se ofrece además un enlace discreto «Cancelar».
 *
 * @param {Object} props - Estado, opciones y callbacks.
 * @param {string} props.id - Id del campo de texto (foco al desplegar).
 * @param {Array<{id: number, label: string, description: string}>} props.baseOptions - Bases permitidas.
 * @param {Object} props.creator - Estado y acciones de useInlineDenominationCreator.
 * @param {string} props.hint - Aviso del catálogo de bases (carga o error) cuando no hay error propio.
 * @param {boolean} props.disabled - Bloquea la fila (envío del servicio o catálogo no disponible).
 * @param {() => void} props.onSave - Guarda la unidad.
 * @param {() => void} props.onCancel - Cierra la fila sin escribir nada (y devuelve el foco).
 * @param {(denomination: Object) => void} props.onUseExisting - Elige la denominación equivalente existente.
 * @returns {import("react").ReactElement} Fila de alta de unidad.
 */
function ServiceUnitCreateField({ baseOptions, creator, disabled, hint, id, onCancel, onSave, onUseExisting }) {
  const busy = disabled || creator.submitting;

  /**
   * Enter guarda y Escape cierra la fila, sin llegar al formulario ni al diálogo.
   *
   * @param {import("react").KeyboardEvent} event - Tecla pulsada en la fila.
   * @returns {void}
   */
  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (!creator.submitting) onCancel();
    } else if (event.key === "Enter" && event.target.id === id) {
      event.preventDefault();
      onSave();
    }
  }

  return (
    <div className="flex w-full flex-col gap-[8px]" data-service-unit-create onKeyDown={handleKeyDown}>
      <div className="flex w-full items-end gap-[16px]">
        <Input
          id={id}
          type="Prefix select"
          size="M"
          label="Nombre de la unidad"
          required
          showLabel
          showLabelInfo={false}
          showLeftIcon={false}
          showRightIcon={false}
          value={creator.text}
          placeholder="Ej. “de recorrido comercial”"
          state={creator.fieldError ? "Error" : "Default"}
          showHint={false}
          disabled={busy}
          prefixOptions={baseOptions}
          prefixValue={creator.unitId}
          prefixAriaLabel="Unidad base de la nueva unidad"
          prefixDisabled={busy || baseOptions.length <= 1}
          onPrefixChange={(option) => creator.changeUnit(option.id)}
          onChange={(event) => creator.changeText(event.target.value)}
          aria-describedby={creator.fieldError || hint ? `${id}-hint` : undefined}
          className="min-w-0 max-w-none flex-1"
          autoComplete="off"
        />
        <Button
          theme="Primary"
          type="Outline"
          size="M"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          disabled={busy || baseOptions.length === 0}
          className="!h-[42px] shrink-0"
          onClick={onSave}
        >
          {creator.submitting ? "Guardando..." : "Guardar"}
        </Button>
      </div>
      {creator.fieldError || hint ? (
        <p
          id={`${id}-hint`}
          className={`text-body-4 m-0 ${creator.fieldError ? "text-[var(--color-danger-100)]" : "text-[var(--color-text-100)]"}`}
          role={creator.fieldError ? "alert" : undefined}
        >
          {creator.fieldError || hint}
        </p>
      ) : null}
      {creator.message ? <p className="text-body-3 m-0 text-[var(--color-danger-100)]" role="alert">{creator.message}</p> : null}
      <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[4px]">
        {creator.duplicate ? (
          <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={busy} onClick={() => onUseExisting(creator.duplicate)}>
            {`Usar «${creator.duplicate.label ?? creator.duplicate.denomination}»`}
          </Button>
        ) : null}
        <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} disabled={creator.submitting} aria-label="Cancelar la creación de la unidad" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export default ServiceUnitCreateField;
