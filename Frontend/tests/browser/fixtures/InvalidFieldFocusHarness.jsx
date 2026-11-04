import { useId, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import Button from "../../../src/components/ui/Button/Button.jsx";
import DropdownMenu from "../../../src/components/ui/DropdownMenu/DropdownMenu.jsx";
import HintText from "../../../src/components/ui/HintText/HintText.jsx";
import Input from "../../../src/components/ui/Input/Input.jsx";
import Label from "../../../src/components/ui/Label/Label.jsx";
import Modal from "../../../src/components/ui/Modal/Modal.jsx";
import TextArea from "../../../src/components/ui/TextArea/TextArea.jsx";
import { useInvalidFieldFocus } from "../../../src/hooks/useInvalidFieldFocus.js";
import "../../../src/index.css";

// Arnés de useInvalidFieldFocus con los componentes compartidos reales. `layout` elige el
// contenedor (página, modal con scroll interno, panel desplazable dentro de la página o un
// formulario en dos pasos) y `server` simula la respuesta del backend al enviar. Con `list=1` se
// añade un error de lista («Añade al menos una referencia») cuyo control está en otro bloque.
const params = new URLSearchParams(window.location.search);
const layout = params.get("layout") || "page";
const serverMode = params.get("server") || "ok";
const listEnabled = params.get("list") === "1";
const REFERENCES = ["Plano", "Fachada", "Corte", "Detalle", "Render", "Maqueta"];
const TYPE_ITEMS = [
  { id: "residential", label: "Residencial", type: "Text" },
  { id: "commercial", label: "Comercial", type: "Text" },
];
const CITIES = ["Maracaibo", "Caracas"];
const EMPTY_VALUES = { city: "", email: "", meeting: "", name: "", notes: "", refs: [], refsQuery: "", type: "" };
const harness = { serverCalls: 0, submissions: 0 };
window.invalidFieldHarness = harness;

/**
 * Reglas locales del arnés: nombre, tipo, ciudad conocida, nota de 10 caracteres y reunión.
 *
 * @param {typeof EMPTY_VALUES} values - Valores del formulario.
 * @returns {Record<string, string>} Errores por campo.
 */
function validate(values) {
  const errors = {};
  if (!values.name.trim()) errors.name = "Ingresa el nombre.";
  if (!values.type) errors.type = "Selecciona el tipo.";
  if (!CITIES.includes(values.city.trim())) errors.city = "Elige una ciudad de la lista.";
  if (values.notes.trim().length < 10) errors.notes = "Escribe al menos 10 caracteres.";
  if (!values.meeting) errors.meeting = "Elige una opción de reunión.";
  if (listEnabled && values.refs.length === 0) errors.refs = "Añade al menos una referencia.";
  return errors;
}

/**
 * Backend simulado: rechaza un correo duplicado (error de campo) o falla sin campo (error general).
 *
 * @returns {Promise<void>} Resuelve si el guardado es correcto.
 */
async function saveOnServer() {
  harness.serverCalls += 1;
  await new Promise((resolve) => window.setTimeout(resolve, 30));
  if (serverMode === "duplicate" && harness.serverCalls === 1) {
    throw Object.assign(new Error("Revisa los datos."), { fields: { email: "Ese correo ya está registrado." } });
  }
  if (serverMode === "general") throw new Error("El servidor no responde.");
}

/**
 * Grupo de opciones con aria-pressed, como MeetingRecommendationField y ChoiceGroup.
 *
 * @param {{error: string, value: string, onChange: (value: string) => void}} props - Estado.
 * @returns {import("react").ReactElement} Grupo.
 */
function MeetingGroup({ error, onChange, value }) {
  const errorId = `${useId()}-error`;
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="text-heading-8">Reunión</span>
      <div role="group" aria-label="Reunión" aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined} className="flex gap-[8px]">
        {["Presencial", "Virtual"].map((option) => (
          <Button key={option} theme="Primary" type={value === option ? "Solid" : "Outline"} size="S" showLeftIcon={false} showRightIcon={false} aria-pressed={value === option} onClick={() => onChange(option)}>
            {option}
          </Button>
        ))}
      </div>
      {error ? <HintText id={errorId} state="Error" hintText={error} role="alert" /> : null}
    </div>
  );
}

/**
 * Error de lista como «Añade al menos un servicio»: el selector (buscador y opciones en un área
 * con scroll propio) va antes y la sección que marca el error, después, separada por contenido.
 *
 * @param {Object} props - Valores, errores y cambios.
 * @returns {import("react").ReactElement} Selector y lista.
 */
function ReferenceList({ errors, onChange, values }) {
  const visible = REFERENCES.filter((reference) => reference.toLowerCase().includes(values.refsQuery.toLowerCase()) && !values.refs.includes(reference));
  return (
    <>
      <div className="flex flex-col gap-[8px]">
        <Input id="harness-ref-search" label="Buscar referencias" showLabelInfo={false} showLeftIcon={false} showRightIcon={false} showHint={false} value={values.refsQuery} className="max-w-none" onChange={(event) => onChange("refsQuery", event.target.value)} />
        <ul id="harness-ref-options" className="m-0 flex max-h-[96px] list-none flex-col gap-[4px] overflow-y-auto p-0" data-ref-options>
          {visible.map((reference) => (
            <li key={reference}><Button theme="Primary" type="Outline" size="S" showLeftIcon={false} showRightIcon={false} onClick={() => onChange("refs", [...values.refs, reference])}>{`Añadir ${reference}`}</Button></li>
          ))}
        </ul>
      </div>
      <div aria-hidden="true" className="h-[240px] shrink-0" />
      <section
        aria-labelledby="harness-refs-title"
        aria-invalid={errors.refs ? true : undefined}
        aria-describedby={errors.refs ? "harness-refs-error" : undefined}
        data-invalid-field-control={errors.refs ? "harness-ref-options harness-ref-search" : undefined}
        className="flex flex-col gap-[8px]"
      >
        <h2 id="harness-refs-title" className="text-heading-8">Referencias añadidas</h2>
        <p>{values.refs.length ? values.refs.join(", ") : "Sin referencias."}</p>
        {errors.refs ? <HintText id="harness-refs-error" state="Error" hintText={errors.refs} role="alert" /> : null}
      </section>
    </>
  );
}

/**
 * Campos del formulario. El tipo va antes que el nombre en el DOM pero se pinta después
 * (columna 2): la navegación debe seguir el orden visual.
 *
 * @param {Object} props - Valores, errores y cambios.
 * @returns {import("react").ReactElement} Campos.
 */
function Fields({ errors, onChange, spacer, values }) {
  const typeErrorId = useId();
  return (
    <>
      {/* Marcadores que la navegación debe ignorar: deshabilitado y oculto. */}
      <input aria-label="Campo heredado deshabilitado" aria-invalid="true" disabled className="h-[24px] border" />
      <div hidden><input aria-label="Campo oculto" aria-invalid="true" /></div>
      <div className="grid grid-cols-1 gap-[16px] sm:grid-cols-2" data-row="identity">
        <div className="flex flex-col gap-[8px] sm:col-start-2 sm:row-start-1" data-field="type">
          <Label label="Tipo" required information={false} />
          <DropdownMenu
            type="Text"
            label="Seleccionar tipo"
            items={TYPE_ITEMS}
            selectedItemId={values.type || undefined}
            onItemSelect={(item) => onChange("type", item.id)}
            className="w-full"
            aria-label="Tipo"
            aria-invalid={errors.type ? true : undefined}
            aria-describedby={errors.type ? typeErrorId : undefined}
          />
          {errors.type ? <HintText id={typeErrorId} state="Error" hintText={errors.type} role="alert" /> : null}
        </div>
        <Input
          id="harness-name"
          label="Nombre"
          required
          showLabelInfo={false}
          showLeftIcon={false}
          showRightIcon={false}
          value={values.name}
          state={errors.name ? "Error" : "Default"}
          showHint={Boolean(errors.name)}
          hintText={errors.name}
          className="max-w-none sm:col-start-1 sm:row-start-1"
          onChange={(event) => onChange("name", event.target.value)}
        />
      </div>
      <Input
        id="harness-city"
        label="Ciudad"
        required
        showLabelInfo={false}
        showLeftIcon={false}
        showRightIcon={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={false}
        value={values.city}
        state={errors.city ? "Error" : "Default"}
        showHint={Boolean(errors.city)}
        hintText={errors.city}
        className="max-w-none"
        onChange={(event) => onChange("city", event.target.value)}
      />
      <TextArea
        id="harness-notes"
        label="Notas"
        showLabelInfo={false}
        value={values.notes}
        state={errors.notes ? "Error" : "Default"}
        showHint={Boolean(errors.notes)}
        hintText={errors.notes || ""}
        className="max-w-none"
        onChange={(event) => onChange("notes", event.target.value)}
      />
      <MeetingGroup error={errors.meeting} value={values.meeting} onChange={(value) => onChange("meeting", value)} />
      {listEnabled ? <ReferenceList errors={errors} onChange={onChange} values={values} /> : null}
      {spacer ? <div aria-hidden="true" className={`${spacer} shrink-0`} data-spacer /> : null}
      <Input
        id="harness-email"
        label="Correo (opcional)"
        showLabelInfo={false}
        showLeftIcon={false}
        showRightIcon={false}
        value={values.email}
        state={errors.email ? "Error" : "Default"}
        showHint={Boolean(errors.email)}
        hintText={errors.email}
        className="max-w-none"
        onChange={(event) => onChange("email", event.target.value)}
      />
    </>
  );
}

/**
 * Estado y envío compartidos por todas las variantes: validación local, guardado simulado y
 * navegación al primer error (también tras un error del backend asociado a un campo).
 *
 * @param {() => ParentNode|null} getContainer - Contenedor de la navegación.
 * @param {{onFieldErrorFromServer?: () => void}} [options] - Efecto extra ante errores del backend.
 * @returns {Object} Valores, errores y acciones.
 */
function useHarnessForm(getContainer, { onFieldErrorFromServer } = {}) {
  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [generalError, setGeneralError] = useState("");
  const [saved, setSaved] = useState(false);
  const focusInvalidField = useInvalidFieldFocus({ getContainer });

  const onChange = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (event) => {
    event?.preventDefault();
    setGeneralError("");
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusInvalidField();
      return;
    }
    try {
      await saveOnServer();
      harness.submissions += 1;
      setSaved(true);
    } catch (error) {
      if (error.fields) {
        setErrors(error.fields);
        onFieldErrorFromServer?.();
      } else {
        setGeneralError(error.message);
      }
      focusInvalidField();
    }
  };

  return { errors, generalError, onChange, saved, submit, values };
}

/** Mensajes generales y de éxito, fuera de los campos. */
function Feedback({ generalError, saved }) {
  return (
    <>
      {generalError ? <p role="alert" data-general-error>{generalError}</p> : null}
      {saved ? <p role="status">Guardado</p> : null}
    </>
  );
}

/** Formulario en la página: el documento es el área desplazable. */
export function PageLayout() {
  const formRef = useRef(null);
  const form = useHarnessForm(() => formRef.current);
  return (
    <main className="mx-auto flex max-w-[720px] flex-col gap-[24px] p-[16px]">
      <h1 className="text-heading-4">Formulario en página</h1>
      <form ref={formRef} noValidate className="flex flex-col gap-[24px]" onSubmit={form.submit}>
        <Fields {...form} spacer="h-[1400px]" />
        <Feedback {...form} />
        <Button theme="Primary" type="Solid" size="M" htmlType="submit" showLeftIcon={false} showRightIcon={false}>Guardar</Button>
      </form>
    </main>
  );
}

/** Formulario en un panel con scroll propio dentro de una página también desplazable. */
export function PanelLayout() {
  const formRef = useRef(null);
  const form = useHarnessForm(() => formRef.current);
  return (
    <main className="flex flex-col gap-[24px] p-[16px]">
      <div aria-hidden="true" className="h-[900px]" data-page-spacer />
      <form ref={formRef} noValidate className="flex flex-col gap-[16px]" onSubmit={form.submit}>
        <section className="flex max-h-[360px] flex-col gap-[24px] overflow-y-auto border p-[16px]" data-scroll-panel>
          <Fields {...form} spacer="h-[700px]" />
        </section>
        <Feedback {...form} />
        <Button theme="Primary" type="Solid" size="M" htmlType="submit" showLeftIcon={false} showRightIcon={false}>Guardar</Button>
      </form>
      <div aria-hidden="true" className="h-[900px]" />
    </main>
  );
}

/** Formulario en Modal (portal y bloqueo de scroll), con el formulario como área desplazable. */
export function ModalLayout() {
  const form = useHarnessForm(() => document.getElementById("harness-modal-form"));
  return (
    <>
      <main className="p-[16px]"><h1 className="text-heading-4">Página bajo el modal</h1><div aria-hidden="true" className="h-[2400px]" data-page-spacer /></main>
      <Modal mount="viewport" visible className="z-[100]">
        <div role="dialog" aria-modal="true" aria-label="Formulario en modal" data-harness-dialog className="flex max-h-[calc(100dvh-32px)] w-full max-w-[560px] flex-col overflow-hidden rounded-[var(--radius-3)] border bg-[var(--color-neutral-100)]">
          <form id="harness-modal-form" noValidate className="flex min-h-0 flex-col gap-[24px] overflow-y-auto p-[16px]" onSubmit={form.submit}>
            <Fields {...form} spacer="h-[900px]" />
            <Feedback {...form} />
          </form>
          <footer className="border-t p-[16px]">
            <Button theme="Primary" type="Solid" size="M" htmlType="submit" form="harness-modal-form" showLeftIcon={false} showRightIcon={false}>Crear</Button>
          </footer>
        </div>
      </Modal>
    </>
  );
}

/**
 * Formulario en dos pasos: el envío se hace desde «Confirmar» y un error del backend en un campo
 * del primer paso vuelve a mostrarlo antes de navegar (como la edición de usuarios).
 */
export function StepsLayout() {
  const containerRef = useRef(null);
  const [step, setStep] = useState("details");
  const form = useHarnessForm(() => containerRef.current, { onFieldErrorFromServer: () => setStep("details") });
  return (
    <main ref={containerRef} className="mx-auto flex max-w-[720px] flex-col gap-[24px] p-[16px]">
      {step === "details" ? (
        <form noValidate className="flex flex-col gap-[24px]" onSubmit={(event) => { event.preventDefault(); setStep("confirm"); }}>
          <Fields {...form} spacer="h-[200px]" />
          <Button theme="Primary" type="Solid" size="M" htmlType="submit" showLeftIcon={false} showRightIcon={false}>Siguiente</Button>
        </form>
      ) : (
        <form noValidate className="flex flex-col gap-[24px]" onSubmit={form.submit}>
          <p>Confirma los datos antes de guardar.</p>
          <Button theme="Primary" type="Solid" size="M" htmlType="submit" showLeftIcon={false} showRightIcon={false}>Confirmar</Button>
        </form>
      )}
      <Feedback {...form} />
    </main>
  );
}

const LAYOUTS = { modal: ModalLayout, page: PageLayout, panel: PanelLayout, steps: StepsLayout };
const Layout = LAYOUTS[layout] ?? PageLayout;
createRoot(document.getElementById("root")).render(<Layout />);
