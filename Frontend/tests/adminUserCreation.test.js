import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("admin users expose the connected creation modal from both new actions", async () => {
  const [page, modal, http] = await Promise.all([
    readFile(new URL("../src/pages/admin-users/AdminUsersPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-users/CreateAdminUserModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/adminApi.js", import.meta.url), "utf8"),
  ]);

  const actionsSource = await readFile(
    new URL("../src/pages/admin-users/hooks/useAdminUsersActions.js", import.meta.url),
    "utf8",
  );

  assert.match(actionsSource, /setIsCreateUserOpen\(true\)/);
  assert.match(actionsSource, /api\.admin\.createUser\(payload\)/);
  assert.match(page, /<CreateAdminUserModal/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /Enviar código de activación/);
  assert.match(modal, /<header className="relative h-\[62px\][^"]*border-b/);
  assert.match(modal, /text-heading-4 absolute left-\[16px\] top-\[16px\]/);
  assert.doesNotMatch(modal, /Completa la información para crear una cuenta/);
  assert.match(modal, /<ModalCloseButton/);
  assert.doesNotMatch(modal, /CloseCircle/);
  assert.match(modal, /<footer className="flex flex-col-reverse gap-\[16px\][^\n]*sm:flex-row sm:items-center">/);
  assert.equal((modal.match(/className="!h-\[41px\] !w-full sm:min-w-0 sm:flex-1"/g) || []).length, 4);
  assert.match(page, /title="Usuario creado correctamente"/);
  assert.match(page, /El usuario quedó registrado\. El enlace de activación se enviará cuando se habilite este flujo\./);
  assert.match(page, /icon=\{<ShieldSecurity size="20" color="currentColor" \/>\}/);
  assert.doesNotMatch(page, /creationMessage/);
  assert.match(modal, /Ingresa nombre y apellido/);
  assert.match(http, /createUser\(payload\)[\s\S]*\/admin\/users[\s\S]*method: "POST"/);
});

test("admin user row actions expose the connected Figma status menu", async () => {
  const [page, menu, modal, http] = await Promise.all([
    readFile(new URL("../src/pages/admin-users/AdminUsersPage.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-users/AdminUserActionsMenu.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-users/AdminUserStatusModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/adminApi.js", import.meta.url), "utf8"),
  ]);

  const actionsSource = await readFile(
    new URL("../src/pages/admin-users/hooks/useAdminUsersActions.js", import.meta.url),
    "utf8",
  );

  assert.match(page, /<AdminUserActionsMenu/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /Suspender/);
  assert.match(menu, /Deshabilitar/);
  assert.match(menu, /Reactivar/);
  assert.match(menu, /Activar/);
  assert.match(page, /<AdminUserStatusModal/);
  assert.match(page, /<AlertToast/);
  assert.match(modal, /¿Deseas suspender al usuario\?/);
  assert.match(modal, /¿Deseas deshabilitar al usuario\?/);
  assert.match(modal, /¿Deseas reactivar al usuario\?/);
  assert.match(modal, /¿Deseas activar al usuario\?/);
  assert.match(modal, /onPrimaryAction=\{onConfirm\}/);
  assert.match(modal, /secondaryActionTheme="Danger"/);
  assert.match(modal, /primaryActionTheme="Danger"/);
  assert.match(modal, /text-\[var\(--color-danger-100\)\]/);
  assert.doesNotMatch(modal, /text-\[var\(--color-warning-200\)\]/);
  assert.match(actionsSource, /if \(change\) changeUserStatus\(change\.user, change\.status\)/);
  assert.match(page, /String\(user\?\.id\) === String\(listedUser\.id\)/);
  assert.match(menu, /createPortal/);
  assert.match(http, /updateUserStatus[\s\S]*\/admin\/users\/\$\{encodeURIComponent\(userId\)\}\/status[\s\S]*method: "PATCH"/);
});

test("the user details drawer opens the connected Figma edit modal", async () => {
  const [drawer, editModal, formModal, http] = await Promise.all([
    readFile(new URL("../src/pages/admin-users/AdminUserDetailsDrawer.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-users/EditAdminUserModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/admin-users/CreateAdminUserModal.jsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api/adminApi.js", import.meta.url), "utf8"),
  ]);

  assert.match(drawer, /onClick=\{\(\) => setEditing\(true\)\}>Editar<\/Button>/);
  assert.match(drawer, /<EditAdminUserModal/);
  assert.match(drawer, /api\.admin\.updateUser/);
  assert.match(editModal, /mode="edit"/);
  assert.match(formModal, /Editar usuario/);
  assert.match(formModal, /max-w-\[696px\]/);
  assert.match(formModal, /editing \? "Siguiente" : "Enviar código de activación"/);
  assert.match(formModal, /setEditStep\("password"\)/);
  assert.match(formModal, /label="Cambiar contraseña"[\s\S]*showPasswordStrength/);
  assert.match(formModal, /label="Confirmar contraseña"/);
  assert.match(formModal, />Anterior<\/Button>/);
  assert.match(formModal, /Confirmar cambios/);
  assert.match(formModal, /\.\.\.\(password \? \{ password \} : \{\}\)/);
  assert.match(http, /updateUser\(\{ payload, userId \}\)[\s\S]*method: "PATCH"/);
});

test("each table edit action loads the complete user before opening the edit modal", async () => {
  const source = await readFile(
    new URL("../src/pages/admin-users/AdminUsersPage.jsx", import.meta.url),
    "utf8",
  );

  const actionsSource = await readFile(
    new URL("../src/pages/admin-users/hooks/useAdminUsersActions.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /Editar: disponible en una próxima sección/);
  assert.match(source, /onClick=\{\(\) => openUserEditor\(listedUser\)\}/);
  assert.match(actionsSource, /api\.admin\.getUserDetails\(\{ userId: listedUser\.id \}\)/);
  assert.match(actionsSource, /setEditingUser\(response\?\.user \|\| listedUser\)/);
  assert.match(source, /<EditAdminUserModal[\s\S]*user=\{editingUser\}/);
  assert.match(actionsSource, /api\.admin\.updateUser\(\{ payload, userId \}\)/);
});
