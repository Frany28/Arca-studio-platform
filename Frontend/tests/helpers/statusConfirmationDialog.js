// Comprobaciones compartidas de StatusConfirmationModal (Servicios y Unidades) en Playwright.

/**
 * Observa en el navegador el ciclo de vida de un diálogo de confirmación de estado: montajes y
 * desmontajes de su portal, instancias simultáneas, animaciones de entrada (scale-[0.985] →
 * scale-100) y cada título, icono y etiqueta principal mostrados, también durante la salida.
 *
 * @param {import("playwright").Page} page - Página con el módulo abierto.
 * @param {{dialogAttribute: string, iconAttribute: string}} attributes - Atributos `data-*` del
 * diálogo y de su icono.
 * @returns {Promise<() => Promise<Object>>} Lectura del registro acumulado.
 */
export async function observeStatusDialog(page, { dialogAttribute, iconAttribute }) {
  await page.evaluate(({ dialogSelector, iconAttribute: iconName }) => {
    const log = { mounts: 0, unmounts: 0, entries: 0, maxInstances: 0, titles: [], icons: [], labels: [] };
    const isDialog = (node) => node.nodeType === 1 && node.matches(dialogSelector);
    const pushChange = (list, value) => {
      if (value && list.at(-1) !== value) list.push(value);
    };
    new MutationObserver((records) => {
      for (const record of records) {
        log.mounts += [...record.addedNodes].filter(isDialog).length;
        log.unmounts += [...record.removedNodes].filter(isDialog).length;
        if (record.type === "attributes" && record.target.classList.contains("scale-100") && record.oldValue?.includes("scale-[0.985]")) log.entries += 1;
      }
      const dialogs = document.querySelectorAll(dialogSelector);
      log.maxInstances = Math.max(log.maxInstances, dialogs.length);
      if (!dialogs[0]) return;
      pushChange(log.titles, dialogs[0].querySelector("[id$='-title']")?.textContent);
      pushChange(log.icons, dialogs[0].querySelector(`[${iconName}]`)?.getAttribute(iconName));
      pushChange(log.labels, [...dialogs[0].querySelectorAll("button")].at(-1)?.textContent.trim());
    }).observe(document.body, { attributeFilter: ["class"], attributeOldValue: true, attributes: true, characterData: true, childList: true, subtree: true });
    window.__statusDialogLog = log;
  }, { dialogSelector: `[${dialogAttribute}]`, iconAttribute });
  return () => page.evaluate(() => structuredClone(window.__statusDialogLog));
}

/**
 * Lee los colores de la variante del diálogo y los esperados según los tokens del Design System:
 * Success al activar y Danger al desactivar, en icono, acción principal y Cancelar (borde y texto).
 *
 * @param {import("playwright").Locator} dialog - Diálogo visible.
 * @param {string} iconAttribute - Atributo `data-*` del icono.
 * @param {boolean} activating - Variante esperada.
 * @returns {Promise<Object>} Colores reales y esperados.
 */
export function readStatusDialogPalette(dialog, iconAttribute, activating) {
  return dialog.evaluate((element, { active, iconName }) => {
    const icon = element.querySelector(`[${iconName}]`);
    const footer = icon.closest(".overflow-hidden").lastElementChild;
    const cancel = footer.querySelector("button:first-child");
    const confirm = footer.querySelector("button:last-child");
    const tokenColor = (token) => {
      const probe = document.createElement("span");
      probe.style.color = token.startsWith("--") ? `var(${token})` : token;
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const main = active ? "--color-success-200" : "--color-danger-100";
    return {
      icon: icon.getAttribute(iconName),
      iconColor: getComputedStyle(icon).color,
      buttonColor: getComputedStyle(confirm).backgroundColor,
      cancelColor: getComputedStyle(cancel).color,
      cancelBorder: getComputedStyle(cancel).borderTopColor,
      expectedMain: tokenColor(main),
      expectedCancel: tokenColor(active && !document.documentElement.classList.contains("dark")
        ? "color-mix(in srgb, var(--color-success-200) 70%, var(--color-neutral-950-uniform))" : main),
    };
  }, { active: activating, iconName: iconAttribute });
}
