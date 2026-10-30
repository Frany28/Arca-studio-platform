import { useMemo, useState } from "react";

import Alert from "../../../../components/ui/Alert/Alert.jsx";
import Button from "../../../../components/ui/Button/Button.jsx";
import TextArea from "../../../../components/ui/TextArea/TextArea.jsx";
import { useUnsavedChangesGuard } from "../../../../hooks/useUnsavedChangesGuard.js";
import { useQuoteDraft } from "../hooks/useQuoteDraft.js";
import { useQuoteReferenceVat } from "../hooks/useQuoteReferenceVat.js";
import { useQuoteSubmit } from "../hooks/useQuoteSubmit.js";
import { calculateQuotePreview } from "../utils/quoteAmounts.js";
import { QUOTE_NOTES_MAX_LENGTH, isQuoteDraftDirty, validateQuoteDraft } from "../utils/quoteDraft.js";
import { QuoteCreatedDialog, QuoteDiscardDialog } from "./QuoteEditorDialogs.jsx";
import QuoteGeneralDataSection from "./QuoteGeneralDataSection.jsx";
import QuoteItemsTable from "./QuoteItemsTable.jsx";
import QuoteServicePicker from "./QuoteServicePicker.jsx";

/**
 * Divisoria de 1 px entre secciones del formulario (Figma «Line 3–6»).
 *
 * @returns {import("react").ReactElement} Separador.
 */
function SectionDivider() {
  return <hr className="m-0 border-0 border-t border-[var(--color-neutral-200)]" />;
}

/**
 * Cuerpo del formulario de cotización (Figma 5771:451934): datos generales, selector de servicios,
 * servicios incluidos con su total, observaciones y acciones. El borrador vive en memoria hasta que
 * el servidor confirma el guardado; un error conserva lo escrito y muestra cada mensaje junto a su
 * campo. Las validaciones del cliente reproducen las del backend, que sigue siendo la autoridad.
 * Con cambios sin guardar, toda salida (Cancelar, sidebar, breadcrumb, Atrás, recarga o cierre)
 * pasa por useUnsavedChangesGuard: dentro de la aplicación se confirma con QuoteDiscardDialog.
 *
 * @param {Object} props - Modo, datos iniciales, catálogo y callbacks.
 * @param {"create"|"edit"} props.mode - Alta o edición.
 * @param {Object} props.initialDraft - Borrador inicial.
 * @param {Object|null} props.quote - Cotización editada (versión y código) o null.
 * @param {{services: Array<Object>, loading: boolean, error: string, reload: () => void}} props.catalog - Tabulador.
 * @param {(response: Object) => void} props.onSaved - Guardado confirmado por la API.
 * @param {() => void} props.onExit - Vuelve al listado; con cambios, la navegación se confirma antes.
 * @param {() => void} props.onReloadQuote - Relee la cotización tras un conflicto de versión.
 * @returns {import("react").ReactElement} Formulario.
 */
function QuoteEditorForm({ catalog, initialDraft, mode, onExit, onReloadQuote, onSaved, quote }) {
  const { actions, draft } = useQuoteDraft(initialDraft);
  const submission = useQuoteSubmit({ expectedVersion: quote?.currentVersion ?? null, mode, quoteId: quote?.id ?? null });
  const [attempted, setAttempted] = useState(false);
  // Respuesta del alta confirmada mientras se muestra «Has creado la cotización»; null si no.
  const [createdResponse, setCreatedResponse] = useState(null);
  const vat = useQuoteReferenceVat(quote?.referenceVat);
  // La tasa es texto: depender de ella (no del objeto) evita recalcular en cada render.
  const vatRate = vat.referenceVat?.rate ?? null;
  const preview = useMemo(
    () => calculateQuotePreview(draft.lines, vatRate === null ? null : { enabled: true, rate: vatRate }),
    [draft.lines, vatRate],
  );
  const activeServices = useMemo(() => catalog.services.filter((service) => service.isActive), [catalog.services]);
  const includedIds = useMemo(() => new Set(draft.lines.map((line) => line.serviceId)), [draft.lines]);
  const localErrors = validateQuoteDraft(draft, preview);
  // Los errores locales se muestran tras el primer intento de guardar; los del servidor, siempre.
  const errors = { ...(attempted ? localErrors : {}), ...submission.result.fieldErrors };
  const { submitting } = submission;
  const guard = useUnsavedChangesGuard({ when: isQuoteDraftDirty(initialDraft, draft) });

  /**
   * Valida y guarda el borrador. Con errores locales no se envía nada y se señalan los campos.
   *
   * @param {import("react").FormEvent<HTMLFormElement>} event - Envío del formulario.
   * @returns {Promise<void>}
   */
  async function handleSubmit(event) {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(localErrors).length || submitting) return;
    const response = await submission.submit(draft);
    if (!response) return;
    // Guardado confirmado: el borrador ya no tiene cambios que perder al volver al listado.
    guard.allowNavigation();
    if (mode === "create") setCreatedResponse(response);
    else onSaved(response);
  }

  return (
    <form className="flex flex-col gap-[48px]" noValidate onSubmit={handleSubmit} aria-busy={submitting || undefined}>
      <SectionDivider />
      <QuoteGeneralDataSection
        client={draft.client}
        project={draft.project}
        errors={errors}
        disabled={submitting}
        onClientChange={(client) => {
          submission.clearFieldError("clientId");
          actions.setClient(client ? { id: client.id, name: client.name, profilePhotoUrl: client.profilePhotoUrl || "" } : null);
        }}
        onProjectChange={(project) => {
          submission.clearFieldError("projectId");
          actions.setProject(project ? { id: project.id, name: project.name } : null);
        }}
      />
      <SectionDivider />
      <QuoteServicePicker
        services={activeServices}
        loading={catalog.loading}
        error={catalog.error}
        onRetry={catalog.reload}
        includedIds={includedIds}
        disabled={submitting}
        onAdd={(services) => {
          submission.clearFieldError("items");
          actions.addServices(services);
        }}
      />
      <SectionDivider />
      <div className="flex flex-col gap-[48px]">
        <QuoteItemsTable
          lines={draft.lines}
          services={activeServices}
          preview={preview}
          vat={vat}
          errors={errors}
          disabled={submitting}
          onLineChange={(key, field, value) => actions.updateLine(key, field, value)}
          onRemove={actions.removeLine}
          onRemoveMany={actions.removeLines}
          onServiceChange={(key, service) => {
            submission.clearFieldError("items");
            actions.replaceService(key, service);
          }}
        />
        <TextArea
          id="quote-notes"
          label="Observaciones (opcional)"
          placeholder="Observaciones generales o elementos a tomar en cuenta."
          showLabelInfo={false}
          showHint={Boolean(errors.notes)}
          hintText={errors.notes || ""}
          state={errors.notes ? "Error" : "Default"}
          value={draft.notes}
          maxLength={QUOTE_NOTES_MAX_LENGTH}
          disabled={submitting}
          // Figma 5771:452385: todo el ancho y caja de 130 px con su borde: 102 de texto, 12 + 12 de
          // relleno, 1 + 1 del borde transparente del campo (foco) y 1 + 1 del borde de la caja.
          // Con rows={4} la altura la fija minHeight.
          rows={4}
          minHeight={102}
          className="max-w-none"
          onChange={(event) => actions.setNotes(event.target.value)}
        />
      </div>

      {submission.result.formError ? (
        <div className="flex flex-col items-start gap-[12px]">
          <Alert
            className="w-full"
            theme="Danger"
            visible
            showActions={false}
            showCloseButton={false}
            title={submission.result.conflict ? "La cotización cambió mientras la editabas" : "No se pudo guardar la cotización"}
            description={submission.result.formError}
            aria-label="Error al guardar la cotización"
          />
          {/* Recargar descarta el borrador, así que es una decisión explícita y no automática. */}
          {submission.result.conflict ? (
            <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} onClick={onReloadQuote}>
              Recargar cotización
            </Button>
          ) : null}
        </div>
      ) : null}

      <SectionDivider />
      <div className="flex items-center justify-end gap-[12px]">
        <Button theme="Primary" type="Outline" size="M" fitContent showLeftIcon={false} showRightIcon={false} disabled={submitting} onClick={onExit}>
          Cancelar
        </Button>
        <Button theme="Primary" type="Solid" size="M" fitContent htmlType="submit" showLeftIcon={false} showRightIcon={false} disabled={submitting} aria-busy={submitting || undefined}>
          {submitting ? "Guardando..." : mode === "edit" ? "Actualizar" : "Guardar"}
        </Button>
      </div>

      <QuoteCreatedDialog open={createdResponse !== null} onAccept={() => onSaved(createdResponse)} />
      {/* Cancelar navega al listado: con cambios, el bloqueo lo detiene y aquí se confirma. */}
      <QuoteDiscardDialog open={guard.blocked} onStay={guard.reset} onDiscard={guard.proceed} />
    </form>
  );
}

export default QuoteEditorForm;
