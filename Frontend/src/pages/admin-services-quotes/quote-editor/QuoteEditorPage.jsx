import { useNavigate, useParams } from "react-router-dom";

import AdminPageTitle from "../../../components/AdminPageTitle.jsx";
import Breadcrumb from "../../../components/ui/Breadcrumb/Breadcrumb.jsx";
import EmptyState from "../../../components/ui/EmptyState/EmptyState.jsx";
import Loader from "../../../components/ui/Loader/Loader.jsx";
import { useQuoteDetail } from "../hooks/useQuoteDetail.js";
import { getQuotesListPath } from "../utils/servicesQuotesTabs.js";
import QuoteEditorForm from "./components/QuoteEditorForm.jsx";
import { EMPTY_QUOTE_DRAFT, draftFromQuote } from "./utils/quoteDraft.js";

const QUOTES_LIST_PATH = getQuotesListPath();

/**
 * Página «Nueva cotización» y edición de una cotización (Figma 5771:452483: variantes Default,
 * Variant5 de edición y estado vacío). Dentro del shell del módulo sustituye la cabecera con
 * indicadores y pestañas por la ruta de navegación y el título. La edición lee la cotización
 * vigente antes de mostrar el formulario; un 404 o un error ofrecen volver o reintentar.
 *
 * @param {Object} props - Modo, catálogo y callbacks.
 * @param {"create"|"edit"} props.mode - Alta o edición (la cotización sale de la URL).
 * @param {{services: Array<Object>, loading: boolean, error: string, reload: () => void}} props.catalog - Tabulador.
 * @param {(notice: {tone: string, title: string, message: string, content?: string}) => void} props.onSaved -
 * Guardado confirmado: actualiza indicadores y muestra el aviso en el listado.
 * @returns {import("react").ReactElement} Página del formulario.
 */
function QuoteEditorPage({ catalog, mode, onSaved }) {
  const navigate = useNavigate();
  const { quoteId } = useParams();
  const editing = mode === "edit";
  const detail = useQuoteDetail(editing ? quoteId : null);
  const quote = detail.quote;
  const currentLabel = editing ? (quote ? `N.° ${quote.code}` : "Cotización") : "Nueva cotización";
  const exitToList = () => navigate(QUOTES_LIST_PATH);

  /**
   * Vuelve al listado tras un guardado confirmado con el aviso correspondiente.
   *
   * @param {{quote: Object, changed?: boolean}} response - Respuesta de la API.
   * @returns {void}
   */
  function handleSaved(response) {
    const saved = response.quote;
    const content = `${saved.code} · ${saved.client.name}`;
    if (!editing) onSaved({ content, message: "Ya está disponible en el listado.", title: "Cotización creada", tone: "success" });
    else if (response.changed === false) onSaved({ content, message: "No había cambios para guardar.", title: "Sin cambios", tone: "success" });
    else onSaved({ content, message: `Se guardó la versión ${saved.currentVersion}.`, title: "Cotización actualizada", tone: "success" });
    navigate(QUOTES_LIST_PATH);
  }

  let body;
  if (editing && detail.loading) {
    body = <Loader preset="quoteEditor" label="Cargando cotización" />;
  } else if (editing && detail.error) {
    body = (
      <EmptyState
        title={detail.notFound ? "La cotización no existe" : "No se pudo cargar la cotización"}
        description={detail.error.message}
        size="S"
        showFeaturedIcon={false}
        showActions
        showSecondaryAction={!detail.notFound}
        primaryActionLabel={detail.notFound ? "Volver a cotizaciones" : "Reintentar"}
        secondaryActionLabel="Volver a cotizaciones"
        onPrimaryAction={detail.notFound ? exitToList : detail.reload}
        onSecondaryAction={exitToList}
        className="min-h-[320px]"
      />
    );
  } else {
    body = (
      <QuoteEditorForm
        // Cada versión leída reinicia el borrador: un conflicto recargado parte del contenido vigente.
        key={quote ? `${quote.id}:${quote.currentVersion}` : "create"}
        mode={mode}
        quote={quote}
        initialDraft={quote ? draftFromQuote(quote) : EMPTY_QUOTE_DRAFT}
        catalog={catalog}
        onSaved={handleSaved}
        onExit={exitToList}
        onReloadQuote={detail.reload}
      />
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-[48px] px-[16px] pb-[48px] sm:px-[24px] lg:px-[48px]" aria-labelledby="quote-editor-title">
      <div className="flex flex-col gap-[12px]">
        <Breadcrumb items={[{ label: "Servicios y cotizaciones", to: QUOTES_LIST_PATH }, { label: currentLabel }]} />
        <header className="flex flex-col gap-[4px]">
          <AdminPageTitle id="quote-editor-title">{editing ? "Cotización" : "Nueva cotización"}</AdminPageTitle>
          <p className="text-body-1 text-[var(--color-text-200)]">
            {editing ? (quote ? `N.° ${quote.code}` : " ") : "Cada proyecto merece ser el correcto."}
          </p>
        </header>
      </div>
      {body}
    </section>
  );
}

export default QuoteEditorPage;
