import clsx from "clsx";

/**
 * Par etiqueta/valor del drawer de solicitud (Figma: Label h8 + valor h8 secundario, gap 8).
 * Debe usarse dentro de un `<dl>` para conservar la semántica de lista de descripciones.
 *
 * @param {Object} props - Etiqueta, contenido y clases opcionales.
 * @param {string} props.label - Nombre del dato.
 * @param {import("react").ReactNode} props.children - Valor, texto o componente (Badge, Tag).
 * @param {string} [props.className] - Clases del contenedor.
 * @returns {import("react").ReactElement} Grupo dt/dd.
 */
function RequestDetailField({ children, className, label }) {
  return (
    <div className={clsx("flex min-w-0 flex-col items-start gap-[8px]", className)}>
      <dt className="text-heading-8 text-[var(--color-text-300)]">{label}</dt>
      <dd className="text-heading-8 m-0 max-w-full break-words text-[var(--color-text-200)]">{children}</dd>
    </div>
  );
}

export default RequestDetailField;
