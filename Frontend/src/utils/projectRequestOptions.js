export const PROJECT_REQUEST_OPTIONS = {
  capitalAvailability: [
    { label: "Disponible ahora", value: "available_now" },
    { label: "En los próximos 3 meses", value: "within_3_months" },
    { label: "Busca financiamiento", value: "seeking_financing" },
    { label: "Indefinido", value: "undefined" },
  ],
  decisionMaker: [
    { label: "Yo solo/a", value: "self" },
    { label: "Con mi pareja/socio", value: "partner" },
    { label: "Familia extendida", value: "extended_family" },
    { label: "Empresa/junta", value: "company_board" },
  ],
  developmentMode: [
    { label: "Por fases", value: "phased" },
    { label: "En su totalidad", value: "full" },
    { label: "Por definir", value: "undecided" },
  ],
  experience: [
    { label: "Sí, buena experiencia", value: "positive" },
    { label: "Sí, mala experiencia", value: "negative" },
    { label: "No, primera vez", value: "first_time" },
  ],
  investmentRange: [
    { label: "No lo tengo definido aún", value: "undefined" },
    { label: "Menos de $10,000 USD", value: "under_10k" },
    { label: "$10,000 - $50,000 USD", value: "10k_50k" },
    { label: "$50,000 - $150,000 USD", value: "50k_150k" },
    { label: "Más de $150,000 USD", value: "over_150k" },
  ],
  landStatus: [
    { label: "Sí, disponible", value: "available" },
    { label: "En proceso de adquirirlo", value: "acquiring" },
    { label: "No todavía", value: "unavailable" },
  ],
  legalDocumentationStatus: [
    { label: "Sí, tengo la documentación disponible", value: "available" },
    { label: "La documentación está en trámite", value: "in_process" },
    { label: "No dispongo de documentación", value: "unavailable" },
  ],
  legalDocumentTypes: [
    { label: "Documento de propiedad", value: "property_deed" },
    { label: "Contrato de compra", value: "purchase_contract" },
    { label: "Contrato de arrendamiento", value: "lease_contract" },
    { label: "Otro documento", value: "other" },
  ],
  multipleOwners: [
    { label: "Sí", value: "yes" },
    { label: "No", value: "no" },
  ],
  projectSize: [
    { label: "Pequeño (menos de 80 m²)", value: "small_lt_80" },
    { label: "Mediano (80-200 m²)", value: "medium_80_200" },
    { label: "Grande (200-500 m²)", value: "large_200_500" },
    { label: "Muy grande (más de 500 m²)", value: "very_large_gt_500" },
    { label: "No lo sé aún", value: "unknown" },
  ],
  projectType: [
    { label: "Residencial", value: "residential" },
    { label: "Comercial", value: "commercial" },
    { label: "Corporativo", value: "corporate" },
    { label: "Stands y exhibiciones", value: "stands_exhibitions" },
  ],
  quality: [
    { label: "Funcional y económico", value: "functional_economic" },
    { label: "Calidad estándar", value: "standard" },
    { label: "Premium", value: "premium" },
    { label: "Exclusivo/lujo", value: "luxury" },
  ],
  startTime: [
    { label: "De inmediato", value: "immediate" },
    { label: "1-3 meses", value: "1_3_months" },
    { label: "3-6 meses", value: "3_6_months" },
    { label: "Más de 6 meses", value: "over_6_months" },
  ],
};

export function optionValues(field) {
  return new Set((PROJECT_REQUEST_OPTIONS[field] || []).map(({ value }) => value));
}
