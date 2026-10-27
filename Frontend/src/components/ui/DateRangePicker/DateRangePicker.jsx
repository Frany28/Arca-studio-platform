import clsx from "clsx";
import { ArrowLeft2, ArrowRight2 } from "iconsax-react";
import { useEffect, useRef, useState } from "react";

import Button from "../Button/Button.jsx";
import {
  WEEKDAY_LABELS,
  addMonths,
  buildMonthGrid,
  formatAccessibleDay,
  formatMonthTitle,
  fromDayKey,
  getRangePosition,
  selectRangeDay,
  toDayKey,
} from "./dateRangeCalendar.js";

// Desplazamientos del foco con el teclado dentro de la cuadrícula (días).
const KEY_OFFSETS = Object.freeze({ ArrowDown: 7, ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7 });

/**
 * Clases de una celda de día según su posición en el intervalo (Figma 3149:163491): extremos
 * sólidos `primary-300` con el lado exterior redondeado, días intermedios `primary-10` y días de
 * otros meses atenuados y no seleccionables.
 *
 * @param {"start"|"end"|"single"|"inside"|"outside"} position - Posición en el intervalo.
 * @param {boolean} inMonth - El día pertenece al mes mostrado.
 * @returns {string} Clases de la celda.
 */
function getDayClassName(position, inMonth) {
  if (!inMonth) return "text-[var(--color-neutral-200)]";
  return clsx(
    "transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-primary-300)]",
    position === "outside" && "rounded-[var(--radius-2)] text-[var(--color-text-200)] hover:bg-[var(--color-neutral-200)]",
    position === "inside" && "bg-[var(--color-primary-10)] text-[var(--color-text-200)]",
    ["start", "end", "single"].includes(position) && "bg-[var(--color-primary-300)] text-[var(--color-neutral-100-uniform)]",
    position === "start" && "rounded-l-[var(--radius-2)]",
    position === "end" && "rounded-r-[var(--radius-2)]",
    position === "single" && "rounded-[var(--radius-2)]",
  );
}

/**
 * Mes del selector: título con navegación y cuadrícula de seis semanas. Solo el día con el foco
 * pertenece al orden de tabulación (patrón de cuadrícula con foco itinerante).
 *
 * @param {Object} props - Mes, intervalo, foco y callbacks.
 * @param {Date} props.month - Mes mostrado.
 * @param {{from: string|null, to: string|null}} props.range - Intervalo en edición.
 * @param {string} props.focusedDay - Día que recibe el foco del teclado.
 * @param {(dayKey: string) => void} props.onSelectDay - Selecciona un día.
 * @param {(event: KeyboardEvent, dayKey: string) => void} props.onDayKeyDown - Teclado de la cuadrícula.
 * @param {(offset: number) => void} props.onNavigate - Cambia los meses visibles.
 * @param {Function} props.registerDay - Registra el botón de cada día para moverle el foco.
 * @returns {import("react").ReactElement} Mes.
 */
function CalendarMonth({ focusedDay, month, onDayKeyDown, onNavigate, onSelectDay, range, registerDay }) {
  const title = formatMonthTitle(month);
  return (
    <div className="flex w-[328px] max-w-full flex-col gap-[8px] p-[24px] max-[375px]:px-[16px]">
      <div className="flex items-center justify-between">
        <Button theme="Primary" type="Ghost" size="S" showText={false} showRightIcon={false} iconLeft={<ArrowLeft2 size="20" color="currentColor" />} aria-label="Mes anterior" tooltip="Mes anterior" onClick={() => onNavigate(-1)} />
        <p className="text-body-2 text-[var(--color-text-300)]" aria-live="polite">{title}</p>
        <Button theme="Primary" type="Ghost" size="S" showText={false} showRightIcon={false} iconLeft={<ArrowRight2 size="20" color="currentColor" />} aria-label="Mes siguiente" tooltip="Mes siguiente" onClick={() => onNavigate(1)} />
      </div>
      <table role="grid" aria-label={title} className="w-full border-separate border-spacing-x-0 border-spacing-y-[2px]">
        <thead>
          <tr>
            {WEEKDAY_LABELS.map((weekday) => (
              <th key={weekday.label} scope="col" abbr={weekday.name} className="h-[40px] p-0 text-center text-body-3 font-normal text-[var(--color-text-100)]">
                {weekday.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {buildMonthGrid(month).map((week) => (
            <tr key={week[0].key}>
              {week.map((day) => {
                const position = day.inMonth ? getRangePosition(day.key, range) : "outside";
                const selected = position !== "outside";
                return (
                  <td key={day.key} className="p-0" aria-selected={day.inMonth ? selected : undefined}>
                    {day.inMonth ? (
                      <button
                        ref={(element) => registerDay(day.key, element)}
                        type="button"
                        tabIndex={day.key === focusedDay ? 0 : -1}
                        aria-label={formatAccessibleDay(day.date)}
                        aria-pressed={selected}
                        className={clsx("flex h-[40px] w-full items-center justify-center text-body-3", getDayClassName(position, true))}
                        onClick={() => onSelectDay(day.key)}
                        onKeyDown={(event) => onDayKeyDown(event, day.key)}
                      >
                        {day.date.getDate()}
                      </button>
                    ) : (
                      <span aria-hidden="true" className={clsx("flex h-[40px] w-full items-center justify-center text-body-3", getDayClassName(position, false))}>
                        {day.date.getDate()}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Panel de selección de un intervalo de fechas (Figma «Date picker menu», variante range): uno
 * o dos meses, clic en el inicio y en el fin, y «Seleccionar» para aplicar o «Cerrar» para
 * descartar. El intervalo se edita en un borrador local: nada cambia fuera hasta aplicarlo.
 *
 * @param {Object} props - Valor, presentación y callbacks.
 * @param {{from: string|null, to: string|null}} props.value - Intervalo aplicado (claves `YYYY-MM-DD`).
 * @param {number} [props.monthsShown=2] - Meses visibles (uno en móvil).
 * @param {(range: {from: string, to: string}) => void} props.onApply - Aplica el intervalo elegido.
 * @param {() => void} props.onClose - Cierra sin aplicar.
 * @param {string} [props.className] - Clases del panel.
 * @returns {import("react").ReactElement} Panel del selector.
 */
function DateRangePicker({ className, monthsShown = 2, onApply, onClose, value }) {
  const initialDay = value?.from ?? toDayKey(new Date());
  const [draft, setDraft] = useState({ from: value?.from ?? null, to: value?.to ?? null });
  const [visibleMonth, setVisibleMonth] = useState(() => addMonths(fromDayKey(initialDay) ?? new Date(), 0));
  const [focusedDay, setFocusedDay] = useState(initialDay);
  const dayRefs = useRef(new Map());
  const shouldFocusDay = useRef(true);
  const months = Array.from({ length: monthsShown }, (_, index) => addMonths(visibleMonth, index));

  // Mueve el foco real al día itinerante al abrir y tras navegar con el teclado, no al pulsar.
  useEffect(() => {
    if (!shouldFocusDay.current) return;
    shouldFocusDay.current = false;
    dayRefs.current.get(focusedDay)?.focus({ preventScroll: true });
  }, [focusedDay, visibleMonth]);

  /**
   * Registra o retira el botón de un día para poder moverle el foco.
   *
   * @param {string} dayKey - Día.
   * @param {HTMLButtonElement|null} element - Botón montado o null al desmontar.
   * @returns {void}
   */
  function registerDay(dayKey, element) {
    if (element) dayRefs.current.set(dayKey, element);
    else dayRefs.current.delete(dayKey);
  }

  /**
   * Lleva el foco a un día y desplaza los meses visibles si queda fuera de ellos.
   *
   * @param {Date} date - Día de destino.
   * @returns {void}
   */
  function moveFocus(date) {
    const firstVisible = visibleMonth;
    const lastVisible = addMonths(visibleMonth, monthsShown - 1);
    const target = addMonths(date, 0);
    if (target < firstVisible) setVisibleMonth(target);
    else if (target > lastVisible) setVisibleMonth(addMonths(target, -(monthsShown - 1)));
    shouldFocusDay.current = true;
    setFocusedDay(toDayKey(date));
  }

  /**
   * Teclado de la cuadrícula: flechas por días y semanas, Inicio/Fin de la semana, Re Pág/Av Pág
   * por meses, y Enter o Espacio para seleccionar (comportamiento nativo del botón).
   *
   * @param {KeyboardEvent} event - Evento de teclado.
   * @param {string} dayKey - Día con el foco.
   * @returns {void}
   */
  function handleDayKeyDown(event, dayKey) {
    const date = fromDayKey(dayKey);
    let target = null;
    if (KEY_OFFSETS[event.key]) target = new Date(date.getFullYear(), date.getMonth(), date.getDate() + KEY_OFFSETS[event.key]);
    else if (event.key === "Home") target = new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
    else if (event.key === "End") target = new Date(date.getFullYear(), date.getMonth(), date.getDate() + (6 - ((date.getDay() + 6) % 7)));
    else if (event.key === "PageUp" || event.key === "PageDown") {
      target = new Date(date.getFullYear(), date.getMonth() + (event.key === "PageUp" ? -1 : 1), date.getDate());
    }
    if (!target) return;
    event.preventDefault();
    moveFocus(target);
  }

  const complete = Boolean(draft.from);

  return (
    <div
      role="dialog"
      aria-label="Seleccionar intervalo de fechas"
      className={clsx(
        "flex flex-col overflow-hidden rounded-[var(--radius-3)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)] shadow-[var(--shadow-e2)]",
        className,
      )}
    >
      <div className="flex max-w-full">
        {months.map((month) => (
          <CalendarMonth
            key={toDayKey(month)}
            month={month}
            range={draft}
            focusedDay={focusedDay}
            registerDay={registerDay}
            onNavigate={(offset) => setVisibleMonth((current) => addMonths(current, offset))}
            onSelectDay={(dayKey) => {
              setFocusedDay(dayKey);
              setDraft((current) => selectRangeDay(current, dayKey));
            }}
            onDayKeyDown={handleDayKeyDown}
          />
        ))}
      </div>
      <div className="flex items-center justify-end gap-[16px] border-t border-[var(--color-neutral-200)] p-[16px]">
        <Button theme="Primary" type="Outline" size="S" fitContent showLeftIcon={false} showRightIcon={false} onClick={onClose}>
          Cerrar
        </Button>
        <Button
          theme="Primary"
          type="Solid"
          size="S"
          fitContent
          showLeftIcon={false}
          showRightIcon={false}
          disabled={!complete}
          onClick={() => onApply({ from: draft.from, to: draft.to ?? draft.from })}
        >
          Seleccionar
        </Button>
      </div>
    </div>
  );
}

export default DateRangePicker;
