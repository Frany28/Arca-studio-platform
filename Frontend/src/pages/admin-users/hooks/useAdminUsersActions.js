import { useState } from "react";

import { api } from "../../../api/http.js";

const METRIC_BY_STATUS = {
  active: "active",
  blocked: "suspended",
  inactive: "disabled",
};
const BULK_FEEDBACK = {
  active: { singular: "Usuario activado", plural: "Usuarios activados", singularVerb: "activó", pluralVerb: "activaron" },
  blocked: { singular: "Usuario suspendido", plural: "Usuarios suspendidos", singularVerb: "suspendió", pluralVerb: "suspendieron" },
  inactive: { singular: "Usuario deshabilitado", plural: "Usuarios deshabilitados", singularVerb: "deshabilitó", pluralVerb: "deshabilitaron" },
};

/**
 * Coordina las mutaciones administrativas y su sincronización con useAdminUsersData.
 * creation controla alta y confirmación; editing carga y guarda el editor; status
 * prepara y ejecuta cambios individuales o masivos; feedback reúne avisos descartables.
 *
 * @param {Object} params - Dependencias de datos y selección proporcionadas por AdminUsersPage.
 * @param {Function} params.setUsers - Setter del listado de la página actual.
 * @param {Function} params.setMetrics - Setter de métricas; los cambios de estado ajustan contadores locales.
 * @param {Function} params.setSelectedUserIds - Setter de un Set de IDs string seleccionados.
 * @param {Array} params.statusFilterIds - Estados filtrados; permite retirar filas que dejan de coincidir.
 * @param {Object} params.bulkTargetsByStatus - Arrays por estado ya evaluados por getBulkStatusTargets
 * en la página, incluyendo elegibilidad y exclusión del actor; el hook no repite esa política.
 * @param {Function} params.reload - Solicita una nueva lectura del listado y métricas.
 * @param {Function} params.resetPagination - Devuelve la lectura a la primera página.
 * @returns {Object} Grupos creation, editing, status y feedback, con estados y acciones.
 * El modal gestiona loading y errores de envío de creación/edición; el hook expone
 * carga de detalles y progreso de estado. feedback.value es Object|null con tone, title y message.
 */
export function useAdminUsersActions({
  setUsers,
  setMetrics,
  setSelectedUserIds,
  statusFilterIds,
  bulkTargetsByStatus,
  reload,
  resetPagination,
}) {
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [createdUser, setCreatedUser] = useState(null);
  const [statusFeedback, setStatusFeedback] = useState(null);
  const [updatingUserId, setUpdatingUserId] = useState(null);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [loadingEditUserId, setLoadingEditUserId] = useState(null);

  /**
   * Envía el alta y guarda el usuario devuelto, o su correo como confirmación mínima.
   * Al tener éxito cierra el modal, reinicia paginación y recarga listado y métricas.
   * El modal consumidor controla loading y captura los errores propagados.
   *
   * @param {Object} payload - Datos del alta preparados por el formulario.
   * @returns {Promise<void>} Finaliza tras el alta y la solicitud de recarga, sin esperar esa lectura.
   * @throws {Error} Propaga el fallo del alta al formulario.
   */
  async function createUser(payload) {
    const response = await api.admin.createUser(payload);
    setCreatedUser(response?.user || { email: payload.email });
    setIsCreateUserOpen(false);
    resetPagination();
    reload();
  }

  /**
   * Carga detalles antes de abrir el editor, con la fila como respaldo si falta user.
   * Omite la apertura si el estado actual indica carga de detalles o cambio de estado;
   * un fallo publica feedback y siempre libera loadingEditUserId. No cancela respuestas obsoletas.
   *
   * @param {Object} listedUser - Fila seleccionada para editar.
   * @returns {Promise<void>} Actualiza el editor o el aviso de error.
   */
  async function openUserEditor(listedUser) {
    if (loadingEditUserId !== null || isBulkUpdating || updatingUserId !== null) return;

    setLoadingEditUserId(String(listedUser.id));
    setStatusFeedback(null);
    try {
      const response = await api.admin.getUserDetails({ userId: listedUser.id });
      setEditingUser(response?.user || listedUser);
    } catch (requestError) {
      setStatusFeedback({
        tone: "danger",
        title: "No se pudo abrir la edición",
        message: requestError?.message || "No se pudieron cargar los datos del usuario.",
      });
    } finally {
      setLoadingEditUserId(null);
    }
  }

  /**
   * Guarda el usuario del editor y, al tener éxito, cierra el modal y mezcla los datos
   * devueltos en su fila local. Solicita recarga para reconciliar listado y métricas.
   * Sin ID no envía; un error conserva el editor, publica feedback y se propaga al modal.
   *
   * @param {Object} payload - Cambios preparados por el formulario de edición.
   * @returns {Promise<void>} Finaliza el guardado y solicita la recarga sin esperarla.
   * @throws {Error} Propaga el fallo del guardado al formulario.
   */
  async function updateEditedUser(payload) {
    const userId = editingUser?.id;
    if (!userId) return;

    setStatusFeedback(null);
    try {
      const response = await api.admin.updateUser({ payload, userId });
      const updatedUser = response?.user;
      setEditingUser(null);
      if (updatedUser) {
        setUsers((current) => current.map((listedUser) => (
          String(listedUser.id) === String(userId)
            ? { ...listedUser, ...updatedUser }
            : listedUser
        )));
      }
      reload();
      setStatusFeedback({
        tone: "success",
        title: "Usuario actualizado correctamente",
        message: "Los datos del usuario se guardaron correctamente.",
      });
    } catch (requestError) {
      setStatusFeedback({
        tone: "danger",
        title: "No se pudo actualizar el usuario",
        message: requestError?.message || "No se pudieron guardar los cambios del usuario.",
      });
      throw requestError;
    }
  }

  /**
   * Ejecuta un cambio individual y sincroniza la fila tras la respuesta de la API.
   * Retira la fila si el estado objetivo no coincide con los filtros, elimina su selección
   * y traslada un contador del estado anterior al nuevo, sin cambiar total ni recargar.
   *
   * @param {Object} listedUser - Usuario y estado previo usados para reconciliar datos locales.
   * @param {string} status - Estado objetivo solicitado por el flujo de confirmación.
   * @returns {Promise<void>} Publica éxito o error y libera updatingUserId; captura errores de la API.
   */
  async function changeUserStatus(listedUser, status) {
    setUpdatingUserId(String(listedUser.id));
    setStatusFeedback(null);
    try {
      const response = await api.admin.updateUserStatus({ status, userId: listedUser.id });
      const updatedUser = response?.user || { ...listedUser, status };
      setUsers((current) => {
        if (statusFilterIds.length && !statusFilterIds.includes(status)) {
          return current.filter((item) => String(item.id) !== String(listedUser.id));
        }
        return current.map((item) => (
          String(item.id) === String(listedUser.id) ? updatedUser : item
        ));
      });
      setSelectedUserIds((current) => {
        const next = new Set(current);
        next.delete(String(listedUser.id));
        return next;
      });
      setMetrics((current) => {
        if (!current || listedUser.status === status) return current;
        return {
          ...current,
          [METRIC_BY_STATUS[listedUser.status]]: Math.max(0, current[METRIC_BY_STATUS[listedUser.status]] - 1),
          [METRIC_BY_STATUS[status]]: current[METRIC_BY_STATUS[status]] + 1,
        };
      });
      setStatusFeedback({
        tone: "success",
        title: status === "blocked"
          ? "Usuario suspendido"
          : status === "inactive"
            ? "Usuario deshabilitado"
            : listedUser.status === "blocked"
              ? "Usuario reactivado"
              : "Usuario activado",
        message: status === "active"
          ? listedUser.status === "blocked"
            ? `${listedUser.name} recuperó el acceso al sistema.`
            : `${listedUser.name} fue activado y recuperó el acceso al sistema.`
          : response?.message || `El estado de ${listedUser.name} fue actualizado.`,
      });
    } catch (requestError) {
      setStatusFeedback({
        tone: "danger",
        title: "No se pudo actualizar el usuario",
        message: requestError?.message || "No se pudo actualizar el estado del usuario.",
      });
    } finally {
      setUpdatingUserId(null);
    }
  }

  /**
   * Prepara la confirmación con los targets ya filtrados por la política de la página.
   * Sin targets o durante otra actualización de estado no abre una nueva confirmación.
   *
   * @param {string} status - Estado objetivo y clave de bulkTargetsByStatus.
   * @returns {void} Limpia feedback y guarda usuarios y estado pendientes.
   */
  function requestBulkStatusChange(status) {
    const targets = bulkTargetsByStatus[status] || [];
    if (!targets.length || isBulkUpdating || updatingUserId !== null) return;
    setStatusFeedback(null);
    setPendingStatusChange({ users: targets, status });
  }

  /**
   * Envía una petición por usuario en paralelo y reúne resultados con allSettled.
   * Tras completar todas, reconcilia solo éxitos: reemplaza o retira filas según filtros,
   * elimina sus IDs de la selección y ajusta métricas por sus estados anteriores.
   * Los fallidos conservan fila y selección; el feedback distingue éxito, fallo parcial
   * y fallo total. No hay atomicidad del conjunto ni recarga; finally libera isBulkUpdating.
   *
   * @param {Array} targets - Usuarios capturados al preparar la confirmación masiva.
   * @param {string} status - Estado objetivo común a las peticiones.
   * @returns {Promise<void>} Finaliza reconciliación y feedback del conjunto.
   */
  async function changeUsersStatus(targets, status) {
    setIsBulkUpdating(true);
    setStatusFeedback(null);

    try {
      const results = await Promise.allSettled(targets.map(async (listedUser) => ({
        listedUser,
        response: await api.admin.updateUserStatus({ status, userId: listedUser.id }),
      })));
      const successfulChanges = results
        .filter((result) => result.status === "fulfilled")
        .map((result) => result.value);
      const failedResults = results.filter((result) => result.status === "rejected");
      const successfulIds = new Set(successfulChanges.map(({ listedUser }) => String(listedUser.id)));
      const updatedById = new Map(successfulChanges.map(({ listedUser, response }) => [
        String(listedUser.id),
        response?.user || { ...listedUser, status },
      ]));

      if (successfulChanges.length) {
        setUsers((current) => current
          .filter((listedUser) => !(
            successfulIds.has(String(listedUser.id))
            && statusFilterIds.length
            && !statusFilterIds.includes(status)
          ))
          .map((listedUser) => updatedById.get(String(listedUser.id)) || listedUser));
        setSelectedUserIds((current) => {
          const next = new Set(current);
          successfulIds.forEach((id) => next.delete(id));
          return next;
        });
        setMetrics((current) => successfulChanges.reduce((nextMetrics, { listedUser }) => {
          if (!nextMetrics || listedUser.status === status) return nextMetrics;
          return {
            ...nextMetrics,
            [METRIC_BY_STATUS[listedUser.status]]: Math.max(
              0,
              nextMetrics[METRIC_BY_STATUS[listedUser.status]] - 1,
            ),
            [METRIC_BY_STATUS[status]]: nextMetrics[METRIC_BY_STATUS[status]] + 1,
          };
        }, current));
      }

      const feedback = BULK_FEEDBACK[status];
      if (!failedResults.length) {
        setStatusFeedback({
          tone: "success",
          title: successfulChanges.length === 1 ? feedback.singular : feedback.plural,
          message: `Se ${successfulChanges.length === 1 ? feedback.singularVerb : feedback.pluralVerb} ${successfulChanges.length} ${successfulChanges.length === 1 ? "usuario" : "usuarios"} correctamente.`,
        });
      } else {
        setStatusFeedback({
          tone: "danger",
          title: successfulChanges.length
            ? "Algunos usuarios no se pudieron actualizar"
            : "No se pudieron actualizar los usuarios",
          message: successfulChanges.length
            ? `${successfulChanges.length} ${successfulChanges.length === 1 ? "usuario fue actualizado" : "usuarios fueron actualizados"} y ${failedResults.length} ${failedResults.length === 1 ? "no pudo actualizarse" : "no pudieron actualizarse"}.`
            : failedResults[0]?.reason?.message || "No se pudo actualizar el estado de los usuarios seleccionados.",
        });
      }
    } finally {
      setIsBulkUpdating(false);
    }
  }

  // Nuevo limpia la confirmación de alta previa; abrir desde vacío solo abre el modal.
  // Cerrar el flujo tampoco descarta createdUser: su aviso tiene dismissConfirmation propio.
  function openFromNew() {
    setCreatedUser(null);
    setIsCreateUserOpen(true);
  }

  function openFromEmpty() {
    setIsCreateUserOpen(true);
  }

  function closeCreation() {
    setIsCreateUserOpen(false);
  }

  function closeEditing() {
    setEditingUser(null);
  }

  // La confirmación individual guarda el usuario recibido sin volver a evaluar la política.
  // Cancelar descarta pendingStatusChange; el feedback se limpia al preparar otra acción.
  function requestIndividual(selectedUser, status) {
    setStatusFeedback(null);
    setPendingStatusChange({ user: selectedUser, status });
  }

  function cancelStatusChange() {
    setPendingStatusChange(null);
  }

  /**
   * Consume y cierra la confirmación antes de iniciar la mutación correspondiente.
   * La presencia de users selecciona el flujo masivo; user selecciona el individual.
   *
   * @returns {void} Inicia la operación sin devolver ni esperar su promesa.
   */
  function confirmStatusChange() {
    const change = pendingStatusChange;
    setPendingStatusChange(null);
    if (change?.users) changeUsersStatus(change.users, change.status);
    else if (change) changeUserStatus(change.user, change.status);
  }

  function dismissConfirmation() {
    setCreatedUser(null);
  }

  function dismissFeedback() {
    setStatusFeedback(null);
  }

  return {
    creation: {
      open: isCreateUserOpen,
      createdUser,
      openFromNew,
      openFromEmpty,
      close: closeCreation,
      submit: createUser,
      dismissConfirmation,
    },
    editing: {
      user: editingUser,
      loadingUserId: loadingEditUserId,
      open: openUserEditor,
      close: closeEditing,
      submit: updateEditedUser,
    },
    status: {
      updatingUserId,
      isBulkUpdating,
      pendingChange: pendingStatusChange,
      requestIndividual,
      requestBulk: requestBulkStatusChange,
      cancel: cancelStatusChange,
      confirm: confirmStatusChange,
    },
    feedback: {
      value: statusFeedback,
      dismiss: dismissFeedback,
    },
  };
}
