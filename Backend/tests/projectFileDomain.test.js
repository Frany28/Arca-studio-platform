import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluateFileAudienceChange,
  evaluateFileVersionAccess,
  evaluateVersionAuthoring,
  hasProjectStaffAccess,
  isProjectOwnerClient,
  resolveClientAudienceOnApproval,
} from "../src/domain/projectFileAccess.js";
import { FILE_CONFIRMED_RULES, FILE_PENDING_DECISIONS, FILE_PROPOSED_RULES, pendingFileDecision } from "../src/domain/projectFileDecisions.js";
import { STORED_FILE_OPERATIONS, evaluateStoredFileOperation } from "../src/domain/projectFileRetention.js";
import {
  evaluateReviewTransition,
  evaluateReviewer,
  planNewVersion,
  resolveCurrentVersion,
  resolveInitialReviewStatus,
} from "../src/domain/projectFileReview.js";
import {
  evaluateWarrantyDocumentLink,
  evaluateWarrantyDocumentMove,
  isInWarrantyDocumentsFolder,
  resolveWarrantyDocumentVersion,
} from "../src/domain/projectWarrantyDocuments.js";

// Dominio de archivos de la Fase 1.2 (B2): conservación, revisión y versiones, audiencias y
// documentos de garantías. Reglas puras, sin PostgreSQL ni almacenamiento.

const DOMAIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/domain");

const admin = { id: 1, role: "admin" };
const architect = { id: 7, role: "architect" };
const otherArchitect = { id: 8, role: "architect" };
const owner = { clientId: 30, id: 31, role: "client" };
const strangerClient = { clientId: 40, id: 41, role: "client" };

/**
 * Proyecto de prueba en curso, asignado al arquitecto 7 y propiedad del cliente 30.
 *
 * @param {object} [overrides] - Campos a sustituir.
 * @returns {object} Proyecto.
 */
const project = (overrides = {}) => ({ archivedFromStatus: null, assignedArchitectId: 7, clientId: 30, isAssignee: false, isPublic: false, status: "in_process", ...overrides });
const version = (id, overrides = {}) => ({ deletedAt: null, id, reviewStatus: "approved", storageKey: `projects/3/key-${id}`, uploadedBy: 7, versionNumber: id, ...overrides });
const file = (overrides = {}) => ({ accessPolicy: 1, clientVersionId: null, fileType: "application/pdf", id: 50, projectId: 3, showcaseVersionId: null, status: "active", ...overrides });

test("las decisiones pendientes están registradas y ninguna regla apunta a un identificador inventado", async () => {
  for (const decision of ["DA1", "DA4"]) assert.ok(FILE_PENDING_DECISIONS[decision], decision);
  // Resueltas en B4 (DA2, DA3, DA5) y B5 (D3, D4): ya no son decisiones pendientes.
  for (const resolved of ["DA2", "DA3", "DA5", "D3", "D4"]) assert.equal(Object.hasOwn(FILE_PENDING_DECISIONS, resolved), false, resolved);
  assert.throws(() => pendingFileDecision("DA99", "X"), { code: "UNKNOWN_FILE_DECISION" });
  const sources = (await readdir(DOMAIN_DIR)).filter((name) => /^project(File|Warranty)/.test(name));
  for (const name of sources) {
    const text = await readFile(path.join(DOMAIN_DIR, name), "utf8");
    for (const [, decision] of text.matchAll(/pendingFileDecision\("([A-Z0-9]+)"/g)) assert.ok(FILE_PENDING_DECISIONS[decision], `${name}: ${decision}`);
  }
});

test("reglas confirmadas en B4 y B5; PR5 y PR6 siguen como propuestas y PR3 se retiró", () => {
  assert.deepEqual(Object.keys(FILE_CONFIRMED_RULES).sort(), ["AU1", "AU2", "D3", "D4", "DA2", "DA3", "DA5", "PR1", "PR2", "PR4"]);
  assert.deepEqual(Object.keys(FILE_PROPOSED_RULES), ["PR5", "PR6"]);
  const history = [version(1), version(2, { reviewStatus: "rejected" }), version(3)];
  // Las confirmadas ya no se marcan como propuesta.
  assert.equal(planNewVersion({ changeNote: "x", kind: "replace", versions: [...history, version(4, { reviewStatus: "pending" })] }).proposal, undefined);
  assert.equal(planNewVersion({ changeNote: "x", kind: "restore", restoreFromVersionId: 2, versions: history }).proposal, undefined);
  assert.equal(evaluateReviewTransition({ action: "reject", reason: "x".repeat(501), version: { reviewStatus: "pending" } }).proposal, undefined);
  const showcase = evaluateFileAudienceChange({
    action: "set_showcase", actor: admin, file: file({ fileType: "image/png" }), project: project({ isPublic: true, status: "finished" }), version: version(2),
  });
  assert.equal(showcase.proposal, undefined, "el escaparate ya no depende del cliente (AU1)");
  assert.equal(showcase.outcome, "allowed");
  assert.equal(evaluateVersionAuthoring(architect, project(), file({ uploadedBy: 99 })).proposal, "PR5");
});

test("reemplazar y restaurar (PR5): equipo con acceso o autor del archivo que conserva el acceso", () => {
  assert.equal(evaluateVersionAuthoring(admin, project({ status: "draft" }), file({ uploadedBy: 99 })).reason, "TEAM_ACCESS");
  assert.equal(evaluateVersionAuthoring(architect, project(), file({ uploadedBy: 99 })).reason, "TEAM_ACCESS");
  assert.equal(evaluateVersionAuthoring(owner, project(), file({ uploadedBy: 31 })).reason, "FILE_AUTHOR");
  assert.equal(evaluateVersionAuthoring(owner, project(), file({ uploadedBy: 7 })).outcome, "forbidden", "el cliente no reemplaza archivos ajenos");
  assert.equal(evaluateVersionAuthoring(owner, project({ status: "draft" }), file({ uploadedBy: 31 })).outcome, "forbidden", "un draft no existe para el cliente");
  assert.equal(evaluateVersionAuthoring(otherArchitect, project({ isPublic: true }), file({ uploadedBy: 8 })).outcome, "forbidden", "autor sin acceso");
  assert.equal(evaluateVersionAuthoring(strangerClient, project(), file({ uploadedBy: 41 })).outcome, "forbidden");
});

test("conservación: nada guardado se borra ni se retira; solo se descarta lo que nunca se registró", () => {
  for (const operation of ["delete_stored_object", "delete_version", "retire_file"]) {
    assert.deepEqual(evaluateStoredFileOperation({ operation }), { outcome: "forbidden", reason: "STORED_FILE_RETAINED" }, operation);
  }
  for (const operation of ["archive_file", "unarchive_file"]) {
    assert.deepEqual(evaluateStoredFileOperation({ operation }), { decision: "DA1", outcome: "pending_decision", reason: "FILE_ARCHIVING_UNDECIDED" });
  }
  assert.equal(evaluateStoredFileOperation({ operation: "cancel_unsaved_selection" }).outcome, "allowed");
  assert.equal(evaluateStoredFileOperation({ operation: "discard_unrecorded_object", recorded: false }).outcome, "allowed");
  assert.equal(evaluateStoredFileOperation({ operation: "discard_unrecorded_object", recorded: true }).reason, "RECORDED_OBJECT_RETAINED");
  assert.equal(evaluateStoredFileOperation({ operation: "discard_unrecorded_object", recorded: null }).reason, "UNVERIFIED_OBJECT_RETAINED");
  assert.equal(STORED_FILE_OPERATIONS.length, 7);
  assert.throws(() => evaluateStoredFileOperation({ operation: "purge" }), { code: "UNKNOWN_STORED_FILE_OPERATION" });
});

test("revisión: solo una versión pendiente se aprueba o rechaza, y el rechazo exige motivo", () => {
  const pending = { reviewStatus: "pending" };
  assert.deepEqual(evaluateReviewTransition({ action: "approve", version: pending }), { nextStatus: "approved", outcome: "allowed", reason: "VERSION_APPROVED" });
  assert.equal(evaluateReviewTransition({ action: "reject", reason: "   ", version: pending }).reason, "REJECTION_REASON_REQUIRED");
  assert.equal(evaluateReviewTransition({ action: "reject", reason: "x".repeat(501), version: pending }).reason, "REJECTION_REASON_TOO_LONG");
  assert.deepEqual(evaluateReviewTransition({ action: "reject", reason: "  Falta firma del cliente ", version: pending }), {
    nextStatus: "rejected",
    outcome: "allowed",
    reason: "VERSION_REJECTED",
    rejectionReason: "Falta firma del cliente",
  });
  for (const reviewStatus of ["approved", "rejected"]) {
    for (const action of ["approve", "reject"]) {
      assert.equal(evaluateReviewTransition({ action, reason: "Motivo", version: { reviewStatus } }).reason, "VERSION_ALREADY_REVIEWED");
    }
  }
  assert.equal(evaluateReviewTransition({ action: "approve", version: { reviewStatus: null } }).reason, "LEGACY_VERSION_NOT_REVIEWABLE");
  assert.throws(() => evaluateReviewTransition({ action: "publish", version: pending }), { code: "UNKNOWN_REVIEW_ACTION" });
});

test("revisión: solo el administrador revisa (DA5) y toda versión nueva nace pendiente (DA2)", () => {
  assert.deepEqual(evaluateReviewer({ hasStaffAccess: true, role: "admin" }), { outcome: "allowed", reason: "ADMIN_REVIEWER" });
  assert.deepEqual(evaluateReviewer({ hasStaffAccess: true, role: "architect" }), { outcome: "forbidden", reason: "REVIEWER_NOT_ADMIN" });
  assert.deepEqual(evaluateReviewer({ hasStaffAccess: false, role: "client" }), { outcome: "forbidden", reason: "REVIEWER_NOT_ADMIN" });
  for (const uploaderRole of ["admin", "architect", "client"]) {
    assert.deepEqual(resolveInitialReviewStatus({ uploaderRole }), { outcome: "allowed", reason: "NEW_VERSION_REQUIRES_REVIEW", status: "pending" }, uploaderRole);
  }
  assert.equal(resolveInitialReviewStatus({ uploaderRole: "guest" }).outcome, "forbidden");
});

test("versión vigente: la aprobada o heredada de mayor número; pendientes, rechazadas y retiradas no cuentan", () => {
  assert.equal(resolveCurrentVersion([]), null);
  assert.equal(resolveCurrentVersion([version(1, { reviewStatus: "pending" })]), null);
  assert.equal(resolveCurrentVersion([version(1, { reviewStatus: null }), version(2, { reviewStatus: "pending" })]).id, 1);
  assert.equal(resolveCurrentVersion([version(1), version(2, { reviewStatus: "rejected" }), version(3, { reviewStatus: "pending" })]).id, 1);
  assert.equal(resolveCurrentVersion([version(1), version(2), version(3, { deletedAt: new Date() })]).id, 2);
});

test("reemplazar: versión nueva con motivo, numeración sin huecos reutilizados y una sola pendiente", () => {
  assert.deepEqual(planNewVersion({ kind: "first_upload", versions: [] }), {
    changeNote: null, outcome: "allowed", reason: "FIRST_VERSION", restoredFromVersionId: null, storage: { mode: "new_object" }, versionNumber: 1,
  });
  assert.equal(planNewVersion({ kind: "first_upload", versions: [version(1)] }).reason, "FILE_ALREADY_HAS_VERSIONS");
  const history = [version(1), version(2, { reviewStatus: "rejected" })];
  assert.equal(planNewVersion({ kind: "replace", versions: history }).reason, "CHANGE_NOTE_REQUIRED");
  assert.equal(planNewVersion({ changeNote: "x".repeat(256), kind: "replace", versions: history }).reason, "CHANGE_NOTE_TOO_LONG");
  assert.deepEqual(planNewVersion({ changeNote: " Datos actualizados ", kind: "replace", versions: history }), {
    changeNote: "Datos actualizados", outcome: "allowed", reason: "NEW_VERSION", restoredFromVersionId: null, storage: { mode: "new_object" }, versionNumber: 3,
  });
  assert.equal(planNewVersion({ changeNote: "Otra", kind: "replace", versions: [...history, version(3, { reviewStatus: "pending" })] }).reason, "VERSION_PENDING_REVIEW");
  assert.equal(planNewVersion({ changeNote: "Nota", kind: "replace", versions: [] }).reason, "FILE_HAS_NO_VERSIONS");
  assert.throws(() => planNewVersion({ kind: "copy", versions: [] }), { code: "UNKNOWN_VERSION_KIND" });
});

test("restaurar: versión nueva que reutiliza el objeto de una versión aprobada y conserva el historial", () => {
  const history = [version(1), version(2, { reviewStatus: "rejected" }), version(3)];
  assert.deepEqual(planNewVersion({ changeNote: "Volver al diseño inicial", kind: "restore", restoreFromVersionId: 1, versions: history }), {
    changeNote: "Volver al diseño inicial",
    outcome: "allowed",
    reason: "RESTORED_VERSION",
    restoredFromVersionId: 1,
    storage: { mode: "reuse_object", storageKey: "projects/3/key-1" },
    versionNumber: 4,
  });
  assert.equal(planNewVersion({ changeNote: "x", kind: "restore", restoreFromVersionId: 2, versions: history }).reason, "RESTORE_SOURCE_NOT_APPROVED");
  // Restaurar la vigente no está prohibido: solo se exige una versión aprobada (PR2 confirmada).
  assert.equal(planNewVersion({ changeNote: "x", kind: "restore", restoreFromVersionId: 3, versions: history }).outcome, "allowed");
  assert.equal(planNewVersion({ changeNote: "x", kind: "restore", restoreFromVersionId: 99, versions: history }).reason, "RESTORE_SOURCE_NOT_FOUND");
  assert.equal(planNewVersion({ changeNote: "", kind: "restore", restoreFromVersionId: 1, versions: history }).reason, "CHANGE_NOTE_REQUIRED");
  // Una versión heredada aprobada (sin estado de revisión) también se puede restaurar.
  assert.equal(planNewVersion({ changeNote: "x", kind: "restore", restoreFromVersionId: 1, versions: [version(1, { reviewStatus: null }), version(2)] }).outcome, "allowed");
});

test("acceso de equipo y propietario: el draft solo existe para el administrador y lo público no da acceso de equipo", () => {
  assert.equal(hasProjectStaffAccess(admin, project({ status: "draft" })), true);
  assert.equal(hasProjectStaffAccess(architect, project()), true);
  assert.equal(hasProjectStaffAccess({ id: 9, role: "architect" }, project({ isAssignee: true })), true);
  assert.equal(hasProjectStaffAccess(architect, project({ status: "draft" })), false);
  assert.equal(hasProjectStaffAccess(architect, project({ archivedFromStatus: "draft", status: "archived" })), false);
  assert.equal(hasProjectStaffAccess(otherArchitect, project({ isPublic: true })), false);
  assert.equal(hasProjectStaffAccess(owner, project()), false);
  assert.equal(isProjectOwnerClient(owner, project()), true);
  assert.equal(isProjectOwnerClient(owner, project({ status: "draft" })), false);
  assert.equal(isProjectOwnerClient(strangerClient, project()), false);
});

test("política heredada: reproduce el acceso actual (versión vigente, propietario y escaparate de imágenes y videos)", () => {
  const legacy = file({ accessPolicy: null });
  const current = version(2, { reviewStatus: null });
  const access = (actor, overrides = {}) => evaluateFileVersionAccess({
    actor, currentVersionId: 2, file: overrides.file ?? legacy, project: overrides.project ?? project(), version: overrides.version ?? current,
  });
  assert.equal(access(admin, { project: project({ status: "draft" }) }).outcome, "allowed");
  assert.equal(access(architect).reason, "LEGACY_DIRECT_ACCESS");
  assert.equal(access(owner).audience, "client");
  assert.equal(access(owner, { project: project({ status: "draft" }) }).reason, "PROJECT_DRAFT_HIDDEN");
  assert.equal(access(admin, { version: version(1, { reviewStatus: null }) }).reason, "LEGACY_ONLY_CURRENT_VERSION");
  assert.equal(access(strangerClient).reason, "NO_PROJECT_ACCESS");
  const publicImage = { file: file({ accessPolicy: null, fileType: "image/png" }), project: project({ isPublic: true }) };
  assert.deepEqual(access(strangerClient, publicImage), { anonymized: true, audience: "showcase", outcome: "allowed", reason: "LEGACY_SHOWCASE" });
  assert.deepEqual(access(otherArchitect, publicImage).reason, "LEGACY_SHOWCASE");
  assert.equal(access(strangerClient, { project: project({ isPublic: true }) }).reason, "NO_PROJECT_ACCESS", "un PDF no está en el escaparate");
});

test("versiones pendientes y rechazadas: equipo con acceso o autor con acceso al proyecto; nunca en un draft ajeno", () => {
  const evaluate = (actor, versionOverrides = {}, projectOverrides = {}) => evaluateFileVersionAccess({
    actor, currentVersionId: 1, file: file({ clientVersionId: 1 }), project: project(projectOverrides), version: version(2, { reviewStatus: "pending", ...versionOverrides }),
  });
  for (const reviewStatus of ["pending", "rejected"]) {
    assert.equal(evaluate(admin, { reviewStatus }).reason, "TEAM_ACCESS");
    assert.equal(evaluate(architect, { reviewStatus }).reason, "TEAM_ACCESS");
    assert.equal(evaluate(owner, { reviewStatus }).reason, "VERSION_NOT_APPROVED", "el cliente no ve versiones ajenas sin aprobar");
    assert.equal(evaluate(otherArchitect, { reviewStatus, uploadedBy: 8 }).reason, "VERSION_NOT_APPROVED", "autor sin acceso al proyecto");
    assert.equal(evaluate(owner, { reviewStatus, uploadedBy: 31 }).reason, "VERSION_AUTHOR", "el cliente ve sus propias versiones");
    assert.equal(evaluate(owner, { reviewStatus, uploadedBy: 31 }, { status: "draft" }).reason, "PROJECT_DRAFT_HIDDEN");
    assert.equal(evaluate(otherArchitect, { reviewStatus }, { isPublic: true, status: "finished" }).outcome, "forbidden", "lo público no da acceso");
    assert.equal(evaluate(admin, { reviewStatus }, { status: "draft" }).reason, "TEAM_ACCESS");
  }
});

test("versiones aprobadas: el cliente recibe la compartida; las sustituidas no dan acceso (D4)", () => {
  const shared = file({ clientVersionId: 2 });
  const evaluate = (actor, versionId, extra = {}) => evaluateFileVersionAccess({
    actor, currentVersionId: 3, file: shared, project: project(), version: version(versionId), ...extra,
  });
  assert.equal(evaluate(owner, 2).reason, "SHARED_WITH_CLIENT");
  assert.equal(evaluate(owner, 3).reason, "NOT_SHARED_WITH_CLIENT", "una versión aprobada más reciente no se comparte sola");
  assert.deepEqual(evaluate(owner, 1, { previouslySharedVersionIds: [1] }), { outcome: "forbidden", reason: "PREVIOUS_CLIENT_SHARE_NOT_ACTIVE" });
  assert.equal(evaluate(architect, 1).reason, "TEAM_ACCESS");
  assert.equal(evaluate(strangerClient, 2).reason, "NO_PROJECT_ACCESS");
});

test("escaparate: solo la versión autorizada de una imagen o video de un proyecto público finalizado", () => {
  const showcase = file({ clientVersionId: 2, fileType: "image/jpeg", showcaseVersionId: 2 });
  const evaluate = (actorFile, projectOverrides, versionId = 2) => evaluateFileVersionAccess({
    actor: strangerClient, currentVersionId: 2, file: actorFile, project: project(projectOverrides), version: version(versionId),
  });
  assert.deepEqual(evaluate(showcase, { isPublic: true, status: "finished" }), { anonymized: true, audience: "showcase", outcome: "allowed", reason: "SHOWCASE_VERSION" });
  assert.equal(evaluate(showcase, { isPublic: true, status: "in_process" }).outcome, "forbidden");
  assert.equal(evaluate(showcase, { isPublic: false, status: "finished" }).outcome, "forbidden");
  assert.equal(evaluate(showcase, { isPublic: true, status: "finished" }, 1).outcome, "forbidden");
  assert.equal(evaluate(file({ fileType: "application/pdf", showcaseVersionId: 2 }), { isPublic: true, status: "finished" }).outcome, "forbidden");
});

test("archivos archivados dependen de DA1 y los retirados heredados no son accesibles", () => {
  const base = { actor: admin, currentVersionId: 1, project: project(), version: version(1) };
  assert.deepEqual(evaluateFileVersionAccess({ ...base, file: file({ status: "archived" }) }), { decision: "DA1", outcome: "pending_decision", reason: "ARCHIVED_FILE_ACCESS_UNDECIDED" });
  assert.equal(evaluateFileVersionAccess({ ...base, file: file({ status: "deleted" }) }).reason, "FILE_RETIRED_LEGACY");
  assert.equal(evaluateFileVersionAccess({ ...base, file: file(), version: version(1, { deletedAt: new Date() }) }).reason, "VERSION_RETIRED_LEGACY");
});

test("cambios de audiencia: solo el administrador (D3), versión aprobada (AU2) y audiencias independientes (AU1)", () => {
  const approved = version(2);
  const change = (action, overrides = {}) => evaluateFileAudienceChange({
    action, actor: overrides.actor ?? admin, file: overrides.file ?? file(), project: overrides.project ?? project(), version: overrides.version ?? approved,
  });
  for (const actor of [owner, architect, strangerClient]) {
    assert.equal(change("share_with_client", { actor }).reason, "AUDIENCE_MANAGER_NOT_ADMIN", actor.role);
  }
  assert.equal(change("share_with_client", { version: version(2, { reviewStatus: "pending" }) }).reason, "VERSION_NOT_APPROVED");
  assert.equal(change("share_with_client", { version: version(2, { reviewStatus: "rejected" }) }).reason, "VERSION_NOT_APPROVED");
  assert.deepEqual(change("share_with_client"), { outcome: "allowed", reason: "ADMIN_AUDIENCE_CHANGE" });
  assert.equal(change("unshare_with_client", { version: null }).outcome, "allowed");
  assert.equal(change("set_showcase").reason, "SHOWCASE_REQUIRES_PUBLIC_FINISHED_PROJECT");
  const publicFinished = project({ isPublic: true, status: "finished" });
  assert.equal(change("set_showcase", { project: publicFinished }).reason, "SHOWCASE_MEDIA_ONLY");
  // Independiente del cliente: no exige ninguna versión compartida con él.
  assert.equal(change("set_showcase", { file: file({ fileType: "image/png" }), project: publicFinished }).outcome, "allowed");
  // El formato es el de la versión: una versión PNG de un archivo PDF puede ir al escaparate.
  assert.equal(change("set_showcase", { project: publicFinished, version: version(2, { contentType: "image/png" }) }).outcome, "allowed");
  assert.equal(change("share_with_client", { file: file({ status: "archived" }) }).decision, "DA1");
  assert.throws(() => change("publish"), { code: "UNKNOWN_AUDIENCE_ACTION" });
  assert.deepEqual(resolveClientAudienceOnApproval(), { outcome: "allowed", reason: "APPROVAL_DOES_NOT_SHARE", sharesWithClient: false });
});

test("garantías: el documento vive en «Documentos › Garantías» y se vincula a varias garantías del mismo proyecto", () => {
  const inWarranties = [{ systemKey: "documents" }, { systemKey: "documents.warranties" }];
  const nested = [...inWarranties, { systemKey: null }];
  assert.equal(isInWarrantyDocumentsFolder(inWarranties), true);
  assert.equal(isInWarrantyDocumentsFolder(nested), true, "una subcarpeta personalizada sigue siendo de garantías");
  assert.equal(isInWarrantyDocumentsFolder([{ systemKey: "documents" }]), false);
  assert.equal(isInWarrantyDocumentsFolder([]), false);

  const document = file({ projectId: 3 });
  const link = (overrides = {}) => evaluateWarrantyDocumentLink({
    file: overrides.file ?? document, folderChain: overrides.folderChain ?? nested, linkedWarrantyIds: overrides.linked ?? [], warranty: overrides.warranty ?? { id: 10, projectId: 3 },
  });
  assert.equal(link().outcome, "allowed");
  assert.equal(link({ linked: [11] }).outcome, "allowed", "un documento puede respaldar varias garantías");
  assert.equal(link({ linked: [10] }).reason, "ALREADY_LINKED");
  assert.equal(link({ warranty: { id: 10, projectId: 4 } }).reason, "WARRANTY_FROM_OTHER_PROJECT");
  assert.equal(link({ warranty: { id: 10, projectId: 3, retired: true } }).reason, "WARRANTY_RETIRED");
  assert.equal(link({ folderChain: [{ systemKey: "documents" }, { systemKey: "documents.initial_proposal" }] }).reason, "FILE_OUTSIDE_WARRANTY_FOLDER");
  assert.equal(link({ file: file({ status: "archived" }) }).decision, "DA1");
  assert.equal(link({ file: file({ status: "deleted" }) }).reason, "FILE_NOT_ACTIVE");

  assert.equal(evaluateWarrantyDocumentMove({ activeLinkCount: 2, targetFolderChain: [{ systemKey: "documents" }] }).outcome, "forbidden");
  assert.equal(evaluateWarrantyDocumentMove({ activeLinkCount: 2, targetFolderChain: nested }).outcome, "allowed");
  assert.equal(evaluateWarrantyDocumentMove({ activeLinkCount: 0, targetFolderChain: [{ systemKey: "documents" }] }).outcome, "allowed");
});

test("garantías: el documento usa la política común; el cliente recibe la versión compartida y lo pierde al retirarla", () => {
  const versions = [version(1), version(2), version(3, { reviewStatus: "pending" })];
  const resolve = (actor, fileOverrides = {}, projectOverrides = {}) => resolveWarrantyDocumentVersion({
    actor, file: file({ clientVersionId: 1, ...fileOverrides }), project: project(projectOverrides), versions,
  });
  assert.deepEqual([resolve(admin).visible, resolve(admin).versionId], [true, 2], "el equipo recibe la vigente");
  assert.deepEqual([resolve(architect).visible, resolve(architect).versionId], [true, 2]);
  assert.deepEqual([resolve(owner).visible, resolve(owner).versionId], [true, 1], "el cliente recibe la compartida, no la vigente");
  assert.deepEqual(resolve(owner, { clientVersionId: null }), { access: null, versionId: null, visible: false }, "acceso retirado: se omite");
  assert.equal(resolve(strangerClient).visible, false);
  assert.equal(resolve(owner, {}, { status: "draft" }).visible, false);
  // El escaparate nunca expone un documento de garantía, aunque sea una imagen autorizada.
  const showcased = { clientVersionId: 2, fileType: "image/png", showcaseVersionId: 2 };
  assert.equal(resolve(strangerClient, showcased, { isPublic: true, status: "finished" }).visible, false);
  // Un documento heredado sigue la regla actual: el propietario recibe la vigente.
  assert.deepEqual([resolve(owner, { accessPolicy: null }).visible, resolve(owner, { accessPolicy: null }).versionId], [true, 2]);
});
