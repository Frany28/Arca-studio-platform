import clsx from "clsx";

import DropdownMenu from "../../../../components/ui/DropdownMenu/DropdownMenu.jsx";
import HintText from "../../../../components/ui/HintText/HintText.jsx";
import Label from "../../../../components/ui/Label/Label.jsx";
import { SERVICE_MODALITY_OPTIONS } from "../utils/serviceCatalogPresentation.js";

/**
 * Campo «Modalidad de Contratación» del formulario de servicios (Figma 5764:226084, nodo
 * 5924:439642): etiqueta y Dropdown menu con «Detalle por detalle» (`individual`) y «Llave en
 * mano» (`turnkey`). Sin modalidad elegida muestra una indicación y el formulario exige elegirla;
 * un valor fuera del contrato tampoco se preselecciona. Solo informa la elección: las reglas de
 * unidad que dependen de ella las aplica el formulario.
 *
 * @param {Object} props - Valor, estado y callback.
 * @param {string} props.id - Id del contenedor (enfoque al validar y pruebas).
 * @param {string} props.value - Modalidad del borrador (`individual`, `turnkey` o vacía).
 * @param {string} [props.error] - Mensaje de error del campo.
 * @param {boolean} props.disabled - Bloquea el campo durante el envío.
 * @param {(kind: string) => void} props.onChange - Recibe la modalidad elegida.
 * @returns {import("react").ReactElement} Campo de modalidad.
 */
function ServiceModalityField({ disabled, error, id, onChange, value }) {
  const selected = SERVICE_MODALITY_OPTIONS.some((option) => option.id === value) ? value : undefined;

  return (
    <div id={id} className="flex w-full flex-col gap-[8px]" data-service-modality-field>
      {/* Figma no marca este campo con asterisco, aunque el alta exige elegir una modalidad. */}
      <Label label="Modalidad de Contratación" required={false} information={false} />
      <DropdownMenu
        type="Text"
        label="Elige la modalidad"
        supportingText=""
        items={SERVICE_MODALITY_OPTIONS}
        selectedItemId={selected}
        interactive
        disabled={disabled}
        rowHeightClassName="h-[35px]"
        contentPaddingClassName="px-[4px] py-[8px]"
        className={clsx("w-full", error && "border-[var(--color-danger-100)]")}
        aria-label="Modalidad de contratación"
        onItemSelect={(item) => {
          if (item.id !== value) onChange(item.id);
        }}
      />
      {error ? <HintText state="Error" hintText={error} className="w-full" /> : null}
    </div>
  );
}

export default ServiceModalityField;
