export const DEFAULT_ARCHITECTURAL_SETTINGS = Object.freeze({
  canEdit: false,
  environment: "studio",
  exposure: 0.82,
  materialOverrides: {},
  profile: "exterior",
  schemaVersion: 1,
  shadowIntensity: 1.5,
});

/**
 * Construye la ruta del HDR de estudio respetando BASE_URL de Vite.
 * Normaliza una barra final para servir el recurso también desde una subruta.
 *
 * @returns {string} URL del entorno studio-small-09-1k.hdr.
 */
export function getArchitecturalEnvironmentImage() {
  const baseUrl = String(import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
  return `${baseUrl}environments/studio-small-09-1k.hdr`;
}

export const ARCHITECTURAL_PROFILES = Object.freeze({
  exterior: {
    label: "Exterior",
    exposure: 0.82,
    shadowIntensity: 1.5,
    ssao: 1.35,
    bloom: 0.35,
    hemisphere: [0xfff0dc, 0x26374c, 0.78],
  },
  interior: {
    label: "Interior",
    exposure: 0.9,
    shadowIntensity: 1.15,
    ssao: 1.15,
    bloom: 0.45,
    hemisphere: [0xffead2, 0x394250, 1.05],
  },
  night: {
    label: "Noche",
    exposure: 0.72,
    shadowIntensity: 1.35,
    ssao: 1.5,
    bloom: 1.15,
    hemisphere: [0x5974a3, 0x100d16, 0.42],
  },
});

const CATEGORY_PATTERNS = {
  glass: /(glass|vidrio|cristal|window|ventana|mirror|espejo)/i,
  metal: /(metal|steel|acero|alumin|chrome|crom|iron|hierro)/i,
  emissive: /(light|lamp|luz|led|neon|sign|logo|screen|pantalla|luminar)/i,
  vegetation: /(leaf|leaves|plant|planta|grass|cesped|tree|arbol|foliage)/i,
};

/**
 * Clasifica nombres mediante patrones de vidrio, metal, emisión y vegetación.
 * La primera coincidencia del catálogo gana; nombres desconocidos usan opaque.
 *
 * @param {string} [name=""] - Nombre del material.
 * @returns {string} Categoría heurística.
 */
export function classifyArchitecturalMaterial(name = "") {
  const normalized = String(name);
  return (
    Object.entries(CATEGORY_PATTERNS).find(([, pattern]) =>
      pattern.test(normalized),
    )?.[0] || "opaque"
  );
}

/**
 * Construye la referencia usada para overrides por índice y nombre recortado.
 * Limita el nombre a 120 caracteres y usa material si falta; la estabilidad
 * depende de conservar el índice de enumeración del consumidor.
 *
 * @param {Object|null} material - Material con name opcional.
 * @param {number} index - Índice de enumeración.
 * @returns {string} Clave de override.
 */
export function getStableMaterialKey(material, index) {
  const name = String(material?.name || "").trim();
  return name ? `${index}:${name.slice(0, 120)}` : `${index}:material`;
}

/**
 * Elige calidad mediante WebGL2, pointer coarse, memoria y núcleos declarados.
 * Sin window usa medium; sin WebGL2 low; ultra exige puntero no coarse y al menos
 * ocho GB y ocho núcleos. Los datos ausentes de memoria o CPU usan cuatro.
 * Crea un canvas de detección y consulta matchMedia, sin registrar listeners.
 *
 * @returns {string} low, medium o ultra según capacidades estimadas.
 */
export function detectAdaptiveRenderQuality() {
  if (typeof window === "undefined") return "medium";
  const canvas = document.createElement("canvas");
  const hasWebGL2 = Boolean(canvas.getContext("webgl2"));
  if (!hasWebGL2) return "low";
  const mobile = window.matchMedia?.("(pointer: coarse)")?.matches;
  const memory = Number(navigator.deviceMemory || 4);
  const cores = Number(navigator.hardwareConcurrency || 4);
  return !mobile && memory >= 8 && cores >= 8 ? "ultra" : "medium";
}

/**
 * Resuelve clave y override del material y prioriza su categoría explícita.
 * Sin override usa un objeto vacío y clasifica el nombre mediante patrones.
 *
 * @param {Object|null} material - Material candidato.
 * @param {number} index - Índice para su clave.
 * @param {Object} overrides - Overrides indexados por clave.
 * @returns {Object} category, key y override.
 */
function resolveMaterialValues(material, index, overrides) {
  const key = getStableMaterialKey(material, index);
  const override = overrides?.[key] || {};
  const category = override.category || classifyArchitecturalMaterial(material?.name);
  return { category, key, override };
}

/**
 * Modifica in situ materiales y texturas de meshes recorridos por traverse.
 * Activa sombras incluso para materiales excluidos; overrides excluded omiten
 * los ajustes restantes. Conserva mapas de roughness y metalness al aplicar fallbacks,
 * configura transparencia y emisión por categoría y anisotropía de texturas.
 * Enumera materiales únicos por identidad; no clona ni libera recursos.
 *
 * @param {Object|null} root - Raíz Three.js con traverse opcional.
 * @param {Object} [options={}] - Ajustes arquitectónicos.
 * @param {Object} [options.materialOverrides={}] - Overrides por clave de material.
 * @param {string} [options.profile="exterior"] - Perfil; desconocidos usan configuración exterior.
 * @param {number} [options.maximumAnisotropy=4] - Anisotropía aplicada a texturas.
 * @returns {Object} emissiveMeshes detectados; la lista puede repetir meshes con varios materiales emisivos.
 */
export function enhanceThreeArchitecturalMaterials(root, {
  materialOverrides = {},
  profile = "exterior",
  maximumAnisotropy = 4,
} = {}) {
  const emissiveMeshes = [];
  const profileConfig = ARCHITECTURAL_PROFILES[profile] || ARCHITECTURAL_PROFILES.exterior;
  const seen = new Map();

  root?.traverse?.((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material].filter(Boolean);

    materials.forEach((material) => {
      if (!seen.has(material)) seen.set(material, seen.size);
      const index = seen.get(material);
      const { category, override } = resolveMaterialValues(
        material,
        index,
        materialOverrides,
      );
      if (override.excluded) return;

      if (material.isMeshStandardMaterial) {
        material.envMapIntensity = Math.max(material.envMapIntensity ?? 1, 1.15);
        if (!material.roughnessMap) {
          const fallback = category === "metal" ? 0.28 : category === "glass" ? 0.12 : 0.68;
          material.roughness = override.roughness ?? Math.min(material.roughness ?? 1, fallback);
        }
        if (!material.metalnessMap && category === "metal") {
          material.metalness = override.metalness ?? Math.max(material.metalness ?? 0, 0.72);
        }
        if (category === "glass") {
          material.transparent = true;
          material.opacity = override.opacity ?? Math.min(material.opacity ?? 1, 0.48);
          material.depthWrite = false;
        }
        if (category === "emissive") {
          material.emissive.copy(material.color).multiplyScalar(profile === "night" ? 0.9 : 0.35);
          material.emissiveIntensity =
            override.emissiveIntensity ?? (profileConfig.bloom > 1 ? 2.2 : 0.65);
          emissiveMeshes.push(object);
        }
        if (category === "vegetation") material.side = 2;
      }

      [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]
        .filter(Boolean)
        .forEach((texture) => {
          texture.anisotropy = maximumAnisotropy;
          texture.needsUpdate = true;
        });
      material.needsUpdate = true;
    });
  });
  return { emissiveMeshes };
}

/**
 * Ajusta in situ materiales del model-viewer según categoría y overrides.
 * Configura PBR para metal, alpha para vidrio y emisión según perfil; excluidos
 * conservan sus valores. Captura fallos por material para continuar con los demás,
 * sin revertir operaciones previas ni liberar recursos.
 *
 * @param {Object|null} modelViewer - Visor con model.materials opcional.
 * @param {Object|null} settings - Ajustes con materialOverrides y profile.
 * @returns {void}
 */
export function enhanceModelViewerMaterials(modelViewer, settings) {
  const materials = modelViewer?.model?.materials || [];
  materials.forEach((material, index) => {
    const { category, override } = resolveMaterialValues(
      material,
      index,
      settings?.materialOverrides,
    );
    if (override.excluded) return;
    const pbr = material.pbrMetallicRoughness;
    try {
      if (category === "metal") {
        pbr?.setMetallicFactor?.(override.metalness ?? 0.72);
        pbr?.setRoughnessFactor?.(override.roughness ?? 0.28);
      } else if (category === "glass") {
        pbr?.setRoughnessFactor?.(override.roughness ?? 0.12);
        material.setAlphaMode?.("BLEND");
        material.setAlphaCutoff?.(override.opacity ?? 0.48);
      } else if (category === "emissive") {
        const base = pbr?.baseColorFactor || [1, 0.85, 0.65, 1];
        material.setEmissiveFactor?.(base.slice(0, 3));
        material.setEmissiveStrength?.(
          override.emissiveIntensity ?? (settings?.profile === "night" ? 2.2 : 0.65),
        );
      }
    } catch {
      // A material extension may be immutable; retain its authored values.
    }
  });
}
