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

  async function createUser(payload) {
    const response = await api.admin.createUser(payload);
    setCreatedUser(response?.user || { email: payload.email });
    setIsCreateUserOpen(false);
    resetPagination();
    reload();
  }

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

  function requestBulkStatusChange(status) {
    const targets = bulkTargetsByStatus[status] || [];
    if (!targets.length || isBulkUpdating || updatingUserId !== null) return;
    setStatusFeedback(null);
    setPendingStatusChange({ users: targets, status });
  }

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

  function requestIndividual(selectedUser, status) {
    setStatusFeedback(null);
    setPendingStatusChange({ user: selectedUser, status });
  }

  function cancelStatusChange() {
    setPendingStatusChange(null);
  }

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
