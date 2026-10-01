import { useId, useMemo, useRef, useState } from "react";
import clsx from "clsx";

import AlertToast from "../AlertToast/AlertToast.jsx";
import Input from "../Input/Input.jsx";
import { getAvatarPresentation } from "../../../utils/avatarPresentation.js";
import AssigneeRemovalModal from "./AssigneeRemovalModal.jsx";
import {
  getAddedAssignees,
  getRemovedAssignees,
} from "./assigneeSelection.js";

// Representa el campo de responsables con un icono decorativo.
function AssigneeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9.99967 9.99984C12.3009 9.99984 14.1663 8.13436 14.1663 5.83317C14.1663 3.53198 12.3009 1.6665 9.99967 1.6665C7.69849 1.6665 5.83301 3.53198 5.83301 5.83317C5.83301 8.13436 7.69849 9.99984 9.99967 9.99984Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.1585 18.3333C17.1585 15.1083 13.9501 12.5 10.0001 12.5C6.05013 12.5 2.8418 15.1083 2.8418 18.3333"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Permite buscar sin distinguir mayúsculas ni acentos.
function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}

// Obtiene hasta dos iniciales como respaldo del avatar.
function getInitials(name) {
  return String(name || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();
}

// Adapta una persona al formato de etiqueta y avatar que consume Input.
function toTag(person, showAvatar) {
  const avatar = getAvatarPresentation({
    identity: person.id,
    name: person.name,
    roleCode: person.roleCode,
    src: showAvatar
      ? person.profilePhotoUrl || person.avatarUrl || person.photo || ""
      : "",
  });

  return {
    id: String(person.id),
    label: person.name,
    avatar: showAvatar,
    avatarText: avatar.initials || getInitials(person.name) || "E",
    avatarSrc: showAvatar ? avatar.src : "",
    avatarTheme: avatar.theme,
    avatarContent: avatar.content,
    closeIcon: true,
  };
}

// Coordina la selección múltiple, el guardado y la confirmación opcional de bajas.
function AssigneeMultiSelect({
  "aria-label": ariaLabel = "Seleccionar responsables",
  className,
  confirmRemoval = false,
  disabled = false,
  error = "",
  loading = false,
  onChange,
  onRemovalSuccess,
  options = [],
  placeholder = "Asignar responsables...",
  showTagAvatars = true,
  value = [],
}) {
  const inputId = useId();
  const inputRef = useRef(null);
  const [isSaving, setIsSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [localError, setLocalError] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [assignmentFeedback, setAssignmentFeedback] = useState(null);

  // Unifica los IDs como texto para comparar selecciones de distintas fuentes.
  const selectedIds = useMemo(
    () => new Set(value.map((person) => String(person.id))),
    [value],
  );
  // Filtra las opciones por nombre o rol con el mismo criterio de búsqueda.
  const visibleOptions = useMemo(() => {
    const normalizedQuery = normalizeText(query.trim());

    return options.filter((person) => {
      const searchableText = normalizeText(
        `${person.name || ""} ${person.roleName || ""}`,
      );

      return !normalizedQuery || searchableText.includes(normalizedQuery);
    });
  }, [options, query]);
  // Indexa seleccionados y opciones; para IDs repetidos prevalece la opción.
  const peopleById = useMemo(
    () =>
      new Map(
        [...value, ...options].map((person) => [String(person.id), person]),
      ),
    [options, value],
  );
  // Completa los datos desde el índice, conservando los campos de la selección.
  const selectedTags = useMemo(
    () =>
      value.map((person) =>
        toTag(
          { ...peopleById.get(String(person.id)), ...person },
          showTagAvatars,
        ),
      ),
    [peopleById, showTagAvatars, value],
  );
  const optionTags = useMemo(
    () => visibleOptions.map((person) => toTag(person, showTagAvatars)),
    [showTagAvatars, visibleOptions],
  );
  const isDisabled = disabled || loading || isSaving;
  const resolvedError = localError || error;

  // Espera el guardado del consumidor y coordina bloqueo, errores y avisos.
  const commit = async (nextValue, removedAssignees = []) => {
    if (!onChange || isDisabled) return;

    const addedAssignees = getAddedAssignees(value, nextValue);
    setIsSaving(true);
    setLocalError("");
    try {
      await onChange(nextValue);
      setQuery("");
      if (addedAssignees.length) {
        const names = addedAssignees
          .map((assignee) => assignee.name)
          .filter(Boolean)
          .join(", ");

        setAssignmentFeedback({
          id: `assignee-success-${Date.now()}`,
          theme: "Success",
          title: addedAssignees.length === 1
            ? "Responsable asignado exitosamente"
            : "Responsables asignados exitosamente",
          description: names
            ? `${names} ${addedAssignees.length === 1 ? "fue asignado" : "fueron asignados"} correctamente.`
            : "La asignación se guardó correctamente.",
        });
      }
      if (removedAssignees.length) {
        onRemovalSuccess?.(removedAssignees);
      }
      // Difiere el intento de recuperar el foco hasta el siguiente fotograma.
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (changeError) {
      const errorMessage =
        changeError?.message || "No se pudieron guardar los responsables.";

      setLocalError(errorMessage);
      if (addedAssignees.length) {
        setAssignmentFeedback({
          id: `assignee-error-${Date.now()}`,
          theme: "Danger",
          title: addedAssignees.length === 1
            ? "No se pudo asignar al responsable"
            : "No se pudieron asignar los responsables",
          description: errorMessage,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  // Deja las bajas pendientes cuando se requiere confirmación antes de guardar.
  const requestChange = (nextValue) => {
    const removedAssignees = getRemovedAssignees(value, nextValue);

    if (confirmRemoval && removedAssignees.length) {
      setPendingRemoval({ nextValue, removedAssignees });
      return;
    }

    void commit(nextValue);
  };

  // Reconstruye la selección de personas desde los IDs de las etiquetas.
  const handleTagsChange = (nextTags) => {
    const nextValue = nextTags
      .map((tag) => peopleById.get(String(tag.id)))
      .filter(Boolean);

    requestChange(nextValue);
  };

  // Añade la persona elegida solo si existe y aún no está seleccionada.
  const handleTagOptionSelect = (tag) => {
    const person = peopleById.get(String(tag.id));

    if (!person || selectedIds.has(String(person.id))) return;
    void commit([...value, person]);
  };

  // Escape limpia la búsqueda; Enter añade una opción y Backspace solicita la última baja.
  const handleKeyDown = (event) => {
    if (event.key === "Escape") {
      setQuery("");
      return;
    }

    if (event.key === "Enter" && visibleOptions.length) {
      const firstAvailablePerson = visibleOptions.find(
        (person) => !selectedIds.has(String(person.id)),
      );

      if (firstAvailablePerson) {
        event.preventDefault();
        void commit([...value, firstAvailablePerson]);
      }
      return;
    }

    if (event.key === "Backspace" && !query && value.length) {
      event.preventDefault();
      requestChange(value.slice(0, -1));
    }
  };

  // Cierra la confirmación y guarda la selección pendiente con sus bajas.
  const handleConfirmRemoval = () => {
    const removal = pendingRemoval;

    setPendingRemoval(null);
    if (removal) {
      void commit(removal.nextValue, removal.removedAssignees);
    }
  };

  return (
    <>
      <div
        className={clsx("min-w-0", className)}
        onClick={() => {
          if (!isDisabled) inputRef.current?.focus();
        }}
      >
        <Input
          id={inputId}
          inputRef={inputRef}
          type="Tags"
          size="S"
          state={resolvedError ? "Error" : "Default"}
          value={query}
          tags={selectedTags}
          tagOptions={optionTags}
          tagGroupAriaLabel={`${ariaLabel}: empleados disponibles y seleccionados`}
          tagGroupPlacement="overlay"
          showTagOptionsOnFocus
          onTagOptionSelect={handleTagOptionSelect}
          showLabel={false}
          showHint={Boolean(resolvedError)}
          hintText={resolvedError}
          showLabelInfo={false}
          showLeftIcon
          leftIcon={<AssigneeIcon />}
          showRightIcon={isSaving}
          rightIcon={
            isSaving ? (
              <span
                className="size-4 animate-spin rounded-full border-2 border-[var(--color-neutral-300)] border-t-[var(--color-primary-300)]"
                aria-hidden="true"
              />
            ) : null
          }
          rightIconAriaLabel="Guardando responsables"
          required={false}
          disabled={isDisabled}
          placeholder={loading ? "Cargando empleados..." : placeholder}
          className="max-w-none"
          inputClassName="[&::-webkit-search-cancel-button]:hidden"
          aria-label={ariaLabel}
          aria-invalid={Boolean(resolvedError)}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onTagsChange={handleTagsChange}
        />
      </div>

      <AssigneeRemovalModal
        open={Boolean(pendingRemoval)}
        onCancel={() => setPendingRemoval(null)}
        onConfirm={handleConfirmRemoval}
      />

      {assignmentFeedback ? (
        <AlertToast
          trigger={assignmentFeedback.id}
          theme={assignmentFeedback.theme}
          title={assignmentFeedback.title}
          description={assignmentFeedback.description}
          onDismiss={() => setAssignmentFeedback(null)}
          aria-label={assignmentFeedback.title}
        />
      ) : null}
    </>
  );
}

export default AssigneeMultiSelect;
