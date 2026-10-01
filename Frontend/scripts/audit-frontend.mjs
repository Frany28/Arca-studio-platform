import { createRequire } from "node:module";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve("eslint"))("espree");
const normalize = (value) => value.split(path.sep).join("/");
const controlNames = new Set(["button", "input", "textarea", "select", "dialog"]);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => entry.isDirectory()
    ? listFiles(path.join(directory, entry.name))
    : [path.join(directory, entry.name)]));
  return groups.flat().sort();
}

function visit(node, callback) {
  if (!node || typeof node !== "object") return;
  if (node.type) callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "range", "tokens", "comments"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback));
    else if (value && typeof value === "object") visit(value, callback);
  }
}

const absoluteFiles = await listFiles(path.join(root, "src"));
const files = absoluteFiles.map((file) => normalize(path.relative(root, file)));
const fileSet = new Set(files);
const modules = [];
const missingImports = [];
const boundaryViolations = [];
const nativeControls = [];
const routes = [];

function resolveLocal(source, importer) {
  if (!source.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importer), source.split("?")[0]));
  return [base, ...[".js", ".jsx", ".json", "/index.js", "/index.jsx"].map((suffix) => base + suffix)]
    .find((candidate) => fileSet.has(candidate));
}

for (const file of files.filter((name) => /\.(js|jsx)$/.test(name))) {
  const source = await readFile(path.join(root, file), "utf8");
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true }, loc: true });
  const dependencies = [];
  const exports = [];
  let hasJSX = false;
  let forwarding = ast.body.length > 0;
  for (const statement of ast.body) {
    if (!statement.type.startsWith("Export") || !statement.source) forwarding = false;
  }
  visit(ast, (node) => {
    if (node.type === "JSXElement") hasJSX = true;
    if (node.type === "ExportDefaultDeclaration") exports.push("default");
    if (node.type === "ExportNamedDeclaration") {
      node.specifiers?.forEach((item) => exports.push(item.exported.name ?? item.exported.value));
      if (node.declaration?.id) exports.push(node.declaration.id.name);
      node.declaration?.declarations?.forEach((item) => { if (item.id.name) exports.push(item.id.name); });
    }
    const imported = node.type === "ImportExpression" ? node.source
      : ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type) ? node.source : null;
    if (typeof imported?.value === "string") {
      const target = resolveLocal(imported.value, file);
      const entry = { source: imported.value, target: target ?? null, line: node.loc.start.line, dynamic: node.type === "ImportExpression" };
      dependencies.push(entry);
      if (imported.value.startsWith(".") && !target) missingImports.push({ file, ...entry });
      if (target?.startsWith("src/pages/") && /^src\/(components\/ui|utils|api|config)\//.test(file)) {
        boundaryViolations.push({ file, ...entry });
      }
    }
    if (node.type !== "JSXOpeningElement") return;
    const tag = node.name.name;
    if (controlNames.has(tag)) {
      const attributes = Object.fromEntries(node.attributes.filter((item) => item.type === "JSXAttribute")
        .map((item) => [item.name.name, item.value?.value ?? null]));
      nativeControls.push({ file, line: node.loc.start.line, tag, inputType: attributes.type ?? null,
        scope: file.startsWith("src/components/ui/") ? "primitive" : "outside-ui",
        hidden: attributes.type === "file" || attributes.type === "hidden" });
    }
    if (tag === "Route") {
      const routePath = node.attributes.find((item) => item.name?.name === "path")?.value?.value;
      if (routePath) routes.push({ path: routePath, file, line: node.loc.start.line });
    }
  });
  modules.push({ file, hasJSX, forwarding, exports: [...new Set(exports)], dependencies });
}

const byFile = new Map(modules.map((item) => [item.file, item]));
const html = await readFile(path.join(root, "index.html"), "utf8");
const entrypoints = [...html.matchAll(/(?:src|href)=["']\/?(src\/[^"']+)["']/g)].map((match) => match[1]);
const reachable = new Set();
function trace(file) {
  if (reachable.has(file)) return;
  reachable.add(file);
  byFile.get(file)?.dependencies.forEach((item) => { if (item.target) trace(item.target); });
}
entrypoints.forEach(trace);
const consumers = new Map();
modules.forEach((item) => item.dependencies.forEach((dependency) => {
  if (!dependency.target) return;
  const entries = consumers.get(dependency.target) ?? [];
  if (!entries.includes(item.file)) entries.push(item.file);
  consumers.set(dependency.target, entries);
}));
const components = modules.filter((item) => item.hasJSX || (item.forwarding && item.file.endsWith(".jsx")))
  .map((item) => ({ file: item.file, exports: item.exports, forwarding: item.forwarding,
    reachable: reachable.has(item.file), consumers: consumers.get(item.file) ?? [] }));
const dormant = modules.filter((item) => !reachable.has(item.file)).map((item) => item.file);
const summary = {
  files: files.length, modules: modules.length, components: components.length,
  reachableComponents: components.filter((item) => item.reachable).length,
  dormantModules: dormant.length, nativeControlsOutsideUI: nativeControls.filter((item) => item.scope === "outside-ui").length,
  missingImports: missingImports.length, boundaryViolations: boundaryViolations.length,
};
const report = { summary, entrypoints, routes, components, missingImports, boundaryViolations, nativeControls,
  dormantModules: dormant, modules, files };
const row = (cells) => `| ${cells.map((cell) => String(cell).replaceAll("|", "\\|")).join(" | ")} |`;
const table = (headers, rows) => [row(headers), row(headers.map(() => "---")), ...rows.map(row)].join("\n");
const markdown = [
  "# Mapeo del frontend", "",
  "Generado con `pnpm audit:frontend`. El JSON adjunto contiene todos los archivos y las dependencias directas, incluidos imports dinámicos y reexportaciones.", "",
  "## Alcance y límites", "",
  "La alcanzabilidad parte de los scripts de index.html y sigue imports locales de JavaScript/JSX. Un componente alcanzable puede pertenecer a una ruta de ejemplo; esto no confirma que se visite en ejecución. Los consumidores son módulos importadores, no un conteo de renders. No se ejecuta ni elimina código para analizarlo.", "",
  "Un módulo no alcanzable es candidato a revisión, no prueba suficiente para borrarlo: puede ser catálogo, configuración, compatibilidad, recurso usado por CSS o consumidor externo. Los recursos y estilos se enumeran; sus referencias indirectas o construidas en ejecución no se resuelven. No se auditan exports individuales ni la interacción visual.", "",
  "HTML semántico (div, section, form, enlaces, imágenes y videos) sigue siendo necesario. Los controles nativos pertenecen a los componentes base; fuera de ui se revisan contra sus equivalentes. Los inputs file/hidden tienen una finalidad técnica y se identifican aparte.", "",
  "## Resumen", "", table(["Indicador", "Cantidad"], Object.entries(summary)), "",
  "## Organización", "",
  table(["Carpeta", "Responsabilidad", "Archivos"], [
    ["api", "Cliente HTTP y endpoints", "api"], ["assets", "Medios, fuentes e iconos", "assets"],
    ["auth", "Sesión, permisos y proveedores de autenticación", "auth"],
    ["components", "UI compartida y composición de producto", "components"],
    ["config", "Configuración global", "config"], ["contexts", "Contextos compartidos", "contexts"],
    ["data", "Catálogos compartidos", "data"], ["hooks", "Comportamiento reutilizable", "hooks"],
    ["layouts", "Composición de páginas", "layouts"], ["pages", "Rutas y módulos funcionales", "pages"],
    ["styles", "Tokens y tipografía", "styles"], ["utils", "Lógica pura", "utils"],
  ].map(([name, purpose, directory]) => [name, purpose, files.filter((file) => file.startsWith(`src/${directory}/`)).length])), "",
  "## Rutas", "", table(["Ruta", "Declaración"], routes.map((item) => [item.path, `${item.file}:${item.line}`])), "",
  "## Componentes y consumidores", "",
  table(["Componente", "Estado", "Consumidores directos"], components.map((item) => [item.file,
    `${item.reachable ? "Alcanzable" : "No alcanzable"}${item.forwarding ? "; reexportación de compatibilidad" : ""}`,
    item.consumers.join("<br>") || "Sin importadores en src"])), "",
  "## Imports locales inexistentes", "", table(["Archivo", "Línea", "Import"], missingImports.map((item) => [item.file, item.line, item.source])), "",
  "## Dependencias compartidas hacia páginas", "", table(["Archivo", "Línea", "Destino"], boundaryViolations.map((item) => [item.file, item.line, item.target])), "",
  "## Controles nativos fuera de ui", "",
  table(["Archivo", "Línea", "Control", "Clasificación"], nativeControls.filter((item) => item.scope === "outside-ui")
    .map((item) => [item.file, item.line, item.tag, item.hidden ? "Input técnico file/hidden" : "Revisar componente compartido"])), "",
  "## Módulos no alcanzables", "", ...dormant.map((file) => `- ${file}`), "",
].join("\n");
await mkdir(path.join(root, "docs"), { recursive: true });
await writeFile(path.join(root, "docs/FRONTEND_MAP.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(path.join(root, "docs/FRONTEND_MAP.md"), markdown);
console.log(JSON.stringify(summary, null, 2));
if (missingImports.length || boundaryViolations.length || summary.nativeControlsOutsideUI) process.exitCode = 1;
