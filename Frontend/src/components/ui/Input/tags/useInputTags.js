import { useEffect, useRef, useState } from "react";
import { createTagFromText, normalizeTagItem, normalizeTagSearchText } from "./tagUtils.js";

/**
 * Coordina selección, sugerencias, teclado y foco de los tags.
 * La presencia de onTagsChange controla la selección; el valor común se controla aparte.
 * Sin ese callback, tags solo inicializa el estado interno.
 * @param {object} options Tags, consulta, estado del valor común, refs y callbacks.
 * @returns {object} Selección visible, sugerencias, ref de scroll y acciones.
 */
export default function useInputTags({
  resolvedType, tags, tagOptions, currentValue, hasInputText, maxVisibleTagOptions,
  isControlled, setInternalValue, disabled, onTagsChange, onTagOptionSelect,
  onKeyDown, resolvedInputRef,
}) {
  const [selectedTags, setSelectedTags] = useState(() =>
    Array.isArray(tags)
      ? tags.map((tag, index) => normalizeTagItem(tag, `tag-selected-${index}`))
      : [],
  );
  const tagFieldScrollRef = useRef(null);
  const focusFrameRef = useRef(null);
  const tagsActiveRef = useRef(false);
  const tagsAreControlled = typeof onTagsChange === "function";
  const visibleTags =
    resolvedType === "Tags" && tagsAreControlled ? tags : selectedTags;
  const normalizedVisibleTags = Array.isArray(visibleTags) ? visibleTags : [];
  const visibleTagIds = normalizedVisibleTags
    .map((tag, index) => String(tag.id ?? `${tag.label}-${index}`))
    .join("|");
  const selectedTagIds = new Set(
    normalizedVisibleTags.map((tag) => String(tag.id)),
  );
  const normalizedTagOptions = Array.isArray(tagOptions)
    ? tagOptions
        .map((tag, index) => normalizeTagItem(tag, `tag-option-${index}`))
        .filter((tag) => !selectedTagIds.has(String(tag.id)))
    : [];
  const hasSelectedTags =
    resolvedType === "Tags" && normalizedVisibleTags.length > 0;
  const filteredSelectableTags = normalizedTagOptions.filter((option) => {
    const query = normalizeTagSearchText(currentValue);

    if (!query) {
      return true;
    }

    return normalizeTagSearchText(option.label).includes(query);
  });
  const resolvedMaxVisibleTagOptions = Number.isFinite(maxVisibleTagOptions)
    ? Math.max(0, Math.floor(maxVisibleTagOptions))
    : 3;
  const visibleSelectableTags = filteredSelectableTags.slice(
    0,
    resolvedMaxVisibleTagOptions,
  );
  // La selección vuelve al inicio tras el render; este frame sí se cancela al desmontar.
  useEffect(() => {
    if (resolvedType !== "Tags" || !tagFieldScrollRef.current) {
      return undefined;
    }

    const frameId = requestAnimationFrame(() => {
      tagFieldScrollRef.current?.scrollTo({ left: 0 });
    });

    return () => cancelAnimationFrame(frameId);
  }, [resolvedType, visibleTagIds]);

  // Desmontar, cambiar de variante o deshabilitar vuelve obsoleto el foco pendiente sobre la ref.
  useEffect(() => {
    tagsActiveRef.current = resolvedType === "Tags" && !disabled;
    return () => {
      tagsActiveRef.current = false;
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
        focusFrameRef.current = null;
      }
    };
  }, [disabled, resolvedType]);

  /**
   * Selecciona la primera sugerencia coincidente o crea un tag y evita duplicados por ID o etiqueta.
   * Primero actualiza la selección interna si corresponde, luego notifica y limpia solo la consulta interna.
   * @returns {void}
   */
  const handleTagSelection = () => {
    const nextTag =
      visibleSelectableTags.find((option) => {
        const optionLabel = normalizeTagSearchText(option.label);
        const query = normalizeTagSearchText(currentValue);

        return (
          query &&
          optionLabel.includes(query)
        );
      }) ?? createTagFromText(currentValue, normalizedVisibleTags.length);

    if (!nextTag || disabled) {
      return;
    }

    const exists = normalizedVisibleTags.some((tag) => {
      const currentId = String(tag.id ?? "");
      const nextId = String(nextTag.id ?? "");
      const currentLabel = normalizeTagSearchText(tag.label);
      const nextLabel = normalizeTagSearchText(nextTag.label);

      return currentId === nextId || currentLabel === nextLabel;
    });

    if (exists) {
      return;
    }

    const nextTags = [...normalizedVisibleTags, nextTag];
    if (!tagsAreControlled) {
      setSelectedTags(nextTags);
    }
    onTagsChange?.(nextTags);

    if (!isControlled) {
      setInternalValue("");
    }
  };

  /**
   * Elimina por identidad exacta, notifica la selección y después restaura el foco.
   * Solo mantiene el último frame y descarta foco tras desmontar, cambiar de variante o deshabilitar.
   * @param {string|number|undefined} tagId Identificador original del tag.
   * @returns {void}
   */
  const handleRemoveTag = (tagId) => {
    if (disabled) {
      return;
    }

    const nextTags = normalizedVisibleTags.filter((tag) => tag.id !== tagId);
    if (!tagsAreControlled) {
      setSelectedTags(nextTags);
    }
    onTagsChange?.(nextTags);

    // El callback público puede desmontar Input de forma síncrona antes de programar el foco.
    if (!tagsActiveRef.current) return;
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
    }
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      resolvedInputRef.current?.focus();
    });
  };

  /**
   * Delega el clic exclusivamente a onTagOptionSelect cuando está presente.
   * En otro caso actualiza y notifica la selección antes de limpiar la consulta interna.
   * @param {object} tag Sugerencia seleccionada.
   * @returns {void}
   */
  const handleTagOptionSelection = (tag) => {
    if (disabled) {
      return;
    }

    if (onTagOptionSelect) {
      onTagOptionSelect(tag);
      return;
    }

    const nextTags = [...normalizedVisibleTags, tag];
    if (!tagsAreControlled) {
      setSelectedTags(nextTags);
    }
    onTagsChange?.(nextTags);

    if (!isControlled) {
      setInternalValue("");
    }
  };

  /**
   * Consume Enter, coma y Backspace según el contenido y selección actuales.
   * El callback público se ejecuta después, únicamente si el evento no fue prevenido.
   * @param {object} event Evento de teclado del campo común.
   * @returns {void}
   */
  const handleInputKeyDown = (event) => {
    if (disabled) return;
    if (resolvedType === "Tags") {
      if (
        (event.key === "Enter" || event.key === ",") &&
        hasInputText
      ) {
        event.preventDefault();
        handleTagSelection();
      } else if (
        event.key === "Backspace" &&
        !hasInputText &&
        normalizedVisibleTags.length > 0
      ) {
        event.preventDefault();
        handleRemoveTag(
          normalizedVisibleTags[normalizedVisibleTags.length - 1].id,
        );
      }
    }

    if (!event.defaultPrevented) {
      onKeyDown?.(event);
    }
  };

  return {
    normalizedVisibleTags, hasSelectedTags, visibleSelectableTags, tagFieldScrollRef,
    handleRemoveTag, handleTagOptionSelection, handleInputKeyDown,
  };
}
