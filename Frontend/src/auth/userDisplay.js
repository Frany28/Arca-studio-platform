/* Normaliza los datos del usuario para mostrarlos de forma consistente en la interfaz. */
// Construye nombre, iniciales, rol, teléfono y foto con valores de respaldo seguros.
export function getUserDisplay(user) {
  const firstName = String(user?.firstName || "").trim();
  const lastName = String(user?.lastName || "").trim();
  const fullName = String(user?.name || `${firstName} ${lastName}`).trim();
  const email = String(user?.email || "").trim();
  const name = fullName || email || "Usuario";
  const shortName = firstName || name.split(/\s+/)[0] || "Usuario";
  const roleCode = user?.role || user?.roleDetails?.code || "";
  const roleName = user?.roleDetails?.name || roleCode || "Usuario";
  const phone = String(user?.phone || "").trim();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return {
    email,
    initials: initials || "US",
    name,
    phone,
    profilePhotoUrl: user?.profilePhotoUrl || user?.profile_photo_url || "",
    roleCode,
    roleName,
    shortName,
  };
}
