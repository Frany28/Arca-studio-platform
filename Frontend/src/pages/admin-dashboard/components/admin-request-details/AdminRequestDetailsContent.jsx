import Badge from "../../../../components/ui/Badge/Badge.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import Loader from "../../../../components/ui/Loader/Loader.jsx";
import Tag from "../../../../components/ui/Tag/Tag.jsx";
import { formatCalendarDate } from "../../../../utils/relativeTime.js";
import AdminRequestEvaluation from "./AdminRequestEvaluation.jsx";
import RequestDetailField from "./RequestDetailField.jsx";

function Divider() {
  return <div className="h-px w-full shrink-0 bg-[var(--color-neutral-200)]" aria-hidden="true" />;
}

/**
 * Aviso cuando la solicitud no llegó en la cola técnica. Si la cola falló ofrece
 * reintentar; si solo no está en la primera página, explica que el detalle no está cargado.
 */
function PartialDataNotice({ queueError, onRetry }) {
  return (
    <div className="flex flex-col items-start gap-[4px]" role="status">
      <p className="text-body-4 m-0 text-[var(--color-text-100)]">
        {queueError
          ? `No se pudo cargar la información técnica: ${queueError}`
          : "La información técnica de esta solicitud no está disponible en este momento."}
      </p>
      {queueError ? (
        <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Valor de un campo del cliente con sus estados de carga, error y vacío.
 * El cliente se lee aparte, por lo que su error no bloquea el resto del drawer.
 */
function ClientValue({ client, field, emptyText }) {
  if (client.loading) return <Loader preset="detailValue" label="Cargando datos del cliente" />;
  if (client.error) return "No disponible";
  return client.client?.[field] || emptyText;
}

/**
 * Cuerpo del drawer "Detalles de Solicitud" (Figma 3368:97356): resumen, evaluación,
 * datos del proyecto y del cliente separados por divisores, con gap vertical de 24 px.
 *
 * @param {Object} props - Modelo de la solicitud, estado del cliente y de la cola.
 * @param {Object} props.details - Resultado de `buildAdminRequestDetails`.
 * @param {{client: Object|null, error: string, loading: boolean, retry: Function}} props.client - Lectura del cliente.
 * @param {string} [props.queueError] - Error de la cola técnica, si la solicitud no está en ella.
 * @param {Function} props.onRetryQueue - Reintenta la lectura de la cola.
 * @returns {import("react").ReactElement} Secciones del drawer.
 */
function AdminRequestDetailsContent({ client, details, onRetryQueue, queueError }) {
  const unavailableText = "Información no disponible";

  return (
    <>
      <dl className="m-0 flex flex-wrap gap-[24px]">
        <RequestDetailField label="Fecha de creación">
          {formatCalendarDate(details.createdAt)}
        </RequestDetailField>
        <RequestDetailField label="Estado">
          <Badge label={details.status.label} theme={details.status.theme} size="S" />
        </RequestDetailField>
      </dl>

      {details.isPartial ? <PartialDataNotice queueError={queueError} onRetry={onRetryQueue} /> : null}

      <AdminRequestEvaluation details={details} />

      <Divider />

      <dl className="m-0 flex flex-col gap-[24px]">
        <RequestDetailField label="Proyecto">
          <Tag
            label={details.projectName}
            size="S"
            avatar={false}
            checkbox={false}
            closeIcon={false}
            count={false}
            className="max-w-full"
            title={details.projectName}
          />
        </RequestDetailField>
        <RequestDetailField label="Tipo">{details.projectTypeLabel}</RequestDetailField>
        <RequestDetailField label="Ubicación">
          {details.location || (details.isPartial ? unavailableText : "Sin ubicación registrada")}
        </RequestDetailField>
      </dl>

      <Divider />

      <section className="flex flex-col gap-[8px]" aria-label="Cliente">
        <dl className="m-0 flex flex-wrap gap-[24px]">
          <RequestDetailField label="Nombre">
            {details.clientId == null
              ? unavailableText
              : <ClientValue client={client} field="name" emptyText="Sin nombre" />}
          </RequestDetailField>
          <RequestDetailField label="Empresa">
            {details.clientId == null
              ? unavailableText
              : <ClientValue client={client} field="companyName" emptyText="Sin empresa registrada" />}
          </RequestDetailField>
        </dl>
        {client.error && details.clientId != null ? (
          <div className="flex flex-col items-start gap-[4px]" role="status">
            <p className="text-body-4 m-0 text-[var(--color-text-100)]">{client.error}</p>
            <Button theme="Primary" type="Link" size="S" fitContent showLeftIcon={false} showRightIcon={false} onClick={client.retry}>
              Reintentar
            </Button>
          </div>
        ) : null}
      </section>
    </>
  );
}

export default AdminRequestDetailsContent;
