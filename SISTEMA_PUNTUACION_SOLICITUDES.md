# Sistema de evaluación de solicitudes de proyecto

> **Cómo leer este documento.** Describe la **regla de negocio** y su **implementación vigente, la fórmula `3.0`**. La sección 13 registra el estado de cada discrepancia detectada en `v2.2` (D1–D9). Lo que todavía requiere una decisión humana figura en la sección 14 y no se completa con valores supuestos.

---

## 1. Objetivo

Una solicitud se evalúa con **tres métricas independientes**:

| Métrica | Qué responde | Estado |
| --- | --- | --- |
| **Compatibilidad** | ¿Lo respondido es claro, está preparado donde corresponde y es coherente? | Implementada (`3.0`). Se calcula y persiste al enviar. |
| **Información completada** | ¿Qué porcentaje de las preguntas aplicables se respondió? | Implementada. Se calcula al vuelo. |
| **Viabilidad financiera** | ¿El presupuesto y la disponibilidad son coherentes con el proyecto solicitado? | `PENDING_RULES`: faltan reglas aprobadas (sección 9). |

Ninguna se deriva de otra:

- 100 % de información completada no implica 100 % de compatibilidad (caso E).
- La compatibilidad no es un promedio de completitud y viabilidad.
- Ninguna mide cuánto dinero tiene el cliente, si es propietario ni su experiencia previa.

Las métricas **informan** la revisión. No aprueban, rechazan ni bloquean solicitudes, y una puntuación baja nunca impide enviarlas.

| Responsabilidad | Archivo |
| --- | --- |
| Catálogo de opciones, límites de texto y reglas de aplicabilidad | `Backend/src/domain/projectRequest.js` |
| Compatibilidad: evidencias, hallazgos, score y contrato público | `Backend/src/domain/projectRequestCompatibility.js` |
| Información completada | `Backend/src/domain/projectRequestCompleteness.js` |
| Viabilidad financiera | `Backend/src/domain/projectRequestFinancialViability.js` |
| Composición de métricas derivadas | `Backend/src/domain/projectRequestEvaluation.js` |
| Validación del contrato | `Backend/src/validation/projectRequestSchemas.js` |
| Presentación de completitud y viabilidad | `Frontend/src/utils/projectRequestMetrics.js` |
| Pruebas | `Backend/tests/projectRequestScoring.test.js`, `Backend/tests/projectRequestCompleteness.test.js` |

---

## 2. Principios

1. **No dar puntos por responder por responder.**
2. **No dar más puntos por mayor cantidad de dinero.** Ningún rango de inversión vale más que otro.
3. **No penalizar condiciones válidas.** No tener inmueble, buscar financiamiento, iniciar en seis meses o ser un proyecto pequeño no restan por sí mismos.
4. **No penalizar preguntas que no aplican.** No suman, no restan y no cuentan como incompletas.
5. **Una causa, una deducción.** Varias evidencias de la misma causa se consolidan.
6. **Mantener las métricas independientes.**
7. **Toda reducción es explicable.** Cada hallazgo tiene código, categoría, severidad, explicación y evidencias.
8. **La revisión humana conserva la autoridad** sobre la recomendación de reunión y el workflow.
9. **No inventar pesos, porcentajes ni umbrales.** La fórmula `3.0` solo reutiliza pesos ya aprobados en `v2.2`.

### Regla explícita sobre el dinero

```text
Más presupuesto = más compatibilidad   ← NO existe
```

- El monto nunca entrega puntos: los cuatro rangos definidos producen el mismo resultado (caso D).
- Un presupuesto menor no resta automáticamente. Solo interviene cuando es incoherente con el tamaño o la calidad declarados.
- “Busca financiamiento” no resta por sí solo. Solo genera un hallazgo temporal si se combina con un inicio inmediato o en 1–3 meses (caso D2).

---

## 3. Clasificación de preguntas

| Categoría | Significado |
| --- | --- |
| **Puntúa** | Su ausencia o indefinición genera un hallazgo de preparación con su peso aprobado. Todas las respuestas definidas valen lo mismo. |
| **Solo coherencia** | Nunca suma. Solo participa cuando contradice otra respuesta. |
| **Informativa** | No afecta la compatibilidad. Sirve para contexto, contacto, personalización o revisión humana. |
| **Condicional** | Solo se evalúa si otra respuesta hace que aplique. Si no aplica es N/A (sección 5). |

### Matriz de preguntas (fórmula 3.0)

| # | Pregunta | ¿Aplica siempre? | Obligatoria | Tipo | Efecto en compatibilidad | En “Información completada” |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Nombre del proyecto | Sí | Sí | Informativa | Ninguno | Sí |
| 2 | Tipo de proyecto | Sí | Sí | Informativa | Ninguno (su uso en viabilidad está pendiente) | Sí |
| 3 | Ubicación del proyecto | Sí | Sí | Informativa | Ninguno | Sí |
| 4 | Descripción del proyecto | Sí | Sí (30–100 caracteres) | Informativa | Ninguno: la longitud ya no puntúa | Sí |
| 5 | Tamaño aproximado | Sí | No | Puntúa + coherencia | “No lo sé aún” o sin responder: `PROJECT_SIZE_UNDEFINED` (−15). Se cruza con la inversión. | Sí |
| 6 | ¿Cómo desea desarrollar el proyecto? | Sí | Sí | Puntúa + coherencia | “Por definir”: `EXECUTION_MODE_UNDEFINED` (−10, una vez aunque el inicio sea inmediato) | Sí |
| 7 | ¿Tiene terreno o inmueble disponible? | Sí | Sí | Solo coherencia + controla aplicabilidad | Ninguno por sí solo. Se cruza con el plazo de inicio. | Sí |
| 8 | Situación legal del inmueble | No | Sí, si #7 = “Sí, disponible” | Condicional (preparación) | En trámite −3 / no dispone −6 (`LEGAL_DOCUMENTATION_PENDING`) | Si aplica |
| 9 | Documentación disponible | No | Sí, si #8 = disponible | Condicional · Informativa | Ninguno; la cantidad o el tipo no suman | Si aplica |
| 10 | ¿Más de un propietario? | No | Sí, si #7 = “Sí, disponible” | Condicional · Informativa | Ninguno | Si aplica |
| 11 | ¿Dispone de planos del lugar? | No | No | Condicional (preparación) | Sin planos: `BLUEPRINTS_UNAVAILABLE` (−2) | Si aplica |
| 12 | Rango de inversión estimado | Sí | Sí | Puntúa + coherencia | No definido: `FINANCIAL_DEFINITION_INSUFFICIENT` (una sola deducción). Definido: solo coherencia. | Sí |
| 13 | Disponibilidad del capital | Sí | Sí | Solo coherencia | Ninguno por sí solo. Se cruza con el plazo (`CAPITAL_TIMING_MISMATCH`). | Sí |
| 14 | ¿Cuándo espera iniciar? | Sí | Sí | Solo coherencia | Ninguno por sí solo | Sí |
| 15 | ¿Quién toma la decisión final? | Sí | No | Informativa | Ninguno | Sí |
| 16 | Expectativa de calidad | Sí | No | Solo coherencia | Ninguno por sí sola. Se cruza con la inversión. | Sí |
| 17 | ¿Ha trabajado con un arquitecto o diseñador? | Sí | No | Informativa | Ninguno: la experiencia no hace mejor ni peor al cliente | Sí |
| 18 | Imágenes o archivos | Sí | No | Puntúa (claridad) | Sin archivos: `REFERENCE_FILES_MISSING` (−5). La cantidad no multiplica. | No (material complementario) |
| 19 | Link de referencia | Sí | No | Puntúa (claridad) | Sin enlace válido: `REFERENCE_LINK_MISSING` (−2) | No (material complementario) |

---

## 4. Variables retiradas de la puntuación

| Variable | Peso en v2.2 | Fórmula 3.0 | Motivo |
| --- | ---: | --- | --- |
| Terreno o inmueble disponible | 10 / 5 / 0 | Solo coherencia y aplicabilidad | No premiar tener inmueble (D1). |
| Disponibilidad del capital | 25 / 20 / 10 / 0 | Solo coherencia con el plazo | No premiar condiciones económicas (D4). |
| Longitud de la descripción | 10 / 4 | Informativa | La longitud no demuestra claridad (D6). La calidad semántica está pendiente de definición y no se evalúa con IA. |

---

## 5. Reglas condicionales y no aplicabilidad

### 5.1. Terreno o inmueble disponible

| Respuesta | Sección legal | Preguntas #8–#11 |
| --- | --- | --- |
| Sí, disponible | Se muestra | Aplican |
| En proceso de adquirirlo | No se muestra | **N/A** |
| No todavía | No se muestra | **N/A** |

- **Frontend:** oculta la sección y limpia los valores al cambiar la respuesta.
- **Backend:** rechaza datos legales, de propietarios o de planos cuando no hay inmueble disponible.
- **Motor (D3 resuelto):** aplica la misma regla, `hasAvailableProperty`, aunque llegaran datos residuales: sin inmueble, esas reglas no se evalúan.

La documentación disponible (#9) solo aplica si la situación legal es “disponible”. Si se declara disponible sin ningún documento, el motor lo trata como no acreditado.

### 5.2. Regla de no aplicabilidad

Una pregunta que no aplica:

- **no suma** y **no resta** en la compatibilidad;
- **sale del numerador y del denominador** de la información completada;
- **no cuenta como incompleta**.

Con esto, una solicitud coherente sin inmueble puede alcanzar **100** de compatibilidad y **100 %** de información completada (caso C). En `v2.2` su máximo era 82.

---

## 6. Compatibilidad: hallazgos y evidencias

### 6.1. Modelo

```text
Compatibilidad = max(0, min(100, 100 − Σ deducción de cada hallazgo))
```

- **Evidencia:** una condición observable de las respuestas. Por ejemplo, `veryLargeBudgetUnder10k` (tamaño muy grande con presupuesto menor a USD 10.000).
- **Hallazgo:** agrupa todas las evidencias de una misma **causa** y descuenta **una sola vez**: la deducción mayor entre sus evidencias. Su severidad es la mayor de sus evidencias, y su explicación es la de la evidencia de mayor peso.
- **Pesos:** los valores de deducción son los aprobados en `v2.2`; `3.0` no introduce cantidades nuevas. Lo que cambia es que cada causa resta una vez y que la base retirada (sección 4) ya no resta.

#### Por qué una escala de 100 con deducciones y no un cociente

Se evaluó normalizar como `puntos obtenidos aplicables / máximo aplicable`. Tras retirar 45 puntos de base (D1, D4, D6), el cociente multiplicaba por ~2,1 el peso efectivo de cada criterio restante. Por ejemplo, “tamaño no definido” pasaría de restar 15 a restar 32. Eso equivale a introducir pesos nuevos.

La escala con deducciones conserva el impacto aprobado de cada criterio y cumple la regla de no aplicabilidad, porque un criterio N/A nunca genera evidencia. Es un denominador dinámico en la práctica: solo las preguntas aplicables pueden reducir el resultado.

### 6.2. Categorías y severidad

| Categoría | Uso actual |
| --- | --- |
| `FINANCIAL` | Inversión no definida, o insuficiente frente al tamaño o la calidad. |
| `TEMPORAL` | Plazo de inicio frente a capital o inmueble. |
| `SCOPE` | Tamaño o modalidad sin definir. |
| `LEGAL` | Situación legal pendiente (solo con inmueble). |
| `INFORMATION` | Material de referencia o planos ausentes. |
| `CONSISTENCY` | Reservada. Las contradicciones de datos (p. ej. documentos sin inmueble) se rechazan en la validación y no llegan al motor. |

| Severidad | Significado |
| --- | --- |
| `LOW` | Observación menor; no compromete la evaluación. |
| `MEDIUM` | Incoherencia o falta de definición relevante. |
| `HIGH` | Incoherencia crítica para el alcance o el plazo. |

La severidad se declara por evidencia en el catálogo. Hoy coincide con la magnitud histórica: `LOW` < 10 puntos, `MEDIUM` 10–15 y `HIGH` ≥ 20. Es un dato semántico independiente, que podrá ajustarse cuando se aprueben pesos finales.

### 6.3. Catálogo de causas

| Causa | Categoría | Evidencias (deducción · severidad) | Deducción del hallazgo |
| --- | --- | --- | --- |
| `FINANCIAL_DEFINITION_INSUFFICIENT` | FINANCIAL | `investmentRangeUndefined` 15 M · `veryLargeBudgetUndefined` 20 H · `luxuryBudgetUndefined` 20 H · `largeBudgetUndefined` 15 M · `premiumBudgetUndefined` 15 M · `budgetUndefinedImmediate` 10 M · `budgetUndefinedSoon` 5 L | Máximo: 15 o 20 |
| `FINANCIAL_SCOPE_MISMATCH` | FINANCIAL | `veryLargeBudgetUnder10k` 35 H · `luxuryBudgetUnder10k` 30 H · `largeBudgetUnder10k` 25 H · `veryLargeBudget10k50k` 25 H · `premiumBudgetUnder10k` 20 H · `luxuryBudget10k50k` 20 H · `mediumBudgetUnder10k` 10 M | Máximo: 10–35 |
| `CAPITAL_TIMING_MISMATCH` | TEMPORAL | `capitalUndefinedImmediate` 20 H · `financingImmediate` 15 M · `capitalWithin3MonthsImmediate` 10 M · `capitalUndefinedSoon` 10 M · `financingSoon` 8 L | 8–20 |
| `PROPERTY_TIMING_MISMATCH` | TEMPORAL | `landUnavailableImmediate` 20 H · `landAcquiringImmediate` 10 M · `landUnavailableSoon` 10 M | 10–20 |
| `PROJECT_SIZE_UNDEFINED` | SCOPE | `projectSizeUndefined` 15 M | 15 |
| `EXECUTION_MODE_UNDEFINED` | SCOPE | `developmentModeUndefined` 10 M · `modeUndefinedImmediate` 10 M | 10 |
| `LEGAL_DOCUMENTATION_PENDING` | LEGAL | `legalDocumentationUnavailable` 6 L · `legalDocumentationInProcess` 3 L | 3–6 (solo con inmueble) |
| `BLUEPRINTS_UNAVAILABLE` | INFORMATION | `blueprintsUnavailable` 2 L | 2 (solo con inmueble) |
| `REFERENCE_FILES_MISSING` | INFORMATION | `referenceFilesMissing` 5 L | 5 |
| `REFERENCE_LINK_MISSING` | INFORMATION | `referenceLinkMissing` 2 L | 2 |

Los plazos “3–6 meses” y “Más de 6 meses” no generan hallazgos temporales.

### 6.4. Doble penalización (D5 resuelto)

| Situación | v2.2 | 3.0 |
| --- | --- | --- |
| Inversión no definida + muy grande + lujo + inicio inmediato | −15 base −20 −20 −10 = **−65** | Un hallazgo `FINANCIAL_DEFINITION_INSUFFICIENT`: **−20** |
| Presupuesto < USD 10.000 + muy grande + premium | −35 −20 = **−55** | Un hallazgo `FINANCIAL_SCOPE_MISMATCH`: **−35** |
| Modalidad por definir + inicio inmediato | −10 base −10 = **−20** | Un hallazgo `EXECUTION_MODE_UNDEFINED`: **−10** |
| Capital indefinido + inicio inmediato | −25 base −20 = **−45** | Un hallazgo `CAPITAL_TIMING_MISMATCH`: **−20** |
| Sin inmueble + inicio inmediato | −10 base −20 = **−30** | Un hallazgo `PROPERTY_TIMING_MISMATCH`: **−20** |

Causas distintas sí se acumulan. Por ejemplo, un presupuesto insuficiente y un plazo incompatible con el capital son problemas diferentes.

### 6.5. Trazabilidad (D9 resuelto)

- El motor devuelve **todos** los hallazgos, con sus evidencias.
- Al enviar, se persisten en `compatibility_reason_codes` **todos** los códigos de evidencia, ordenados por impacto.
- La API reconstruye los hallazgos desde esos códigos (`findings`) sin exponer los pesos.
- `observations` conserva hasta tres explicaciones, una por causa, para la pantalla de solicitud recibida.

---

## 7. Coherencia por tipo

| Tipo | Qué compara | Dónde se resuelve |
| --- | --- | --- |
| Financiera | Inversión frente a tamaño y calidad | Hallazgos `FINANCIAL` |
| Temporal | Plazo frente a capital e inmueble | Hallazgos `TEMPORAL` |
| Legal | Inmueble frente a datos legales | Validación: el envío se rechaza |
| Datos | Respuestas mutuamente incompatibles (p. ej. documentos marcados con estado “en trámite”) | Validación: el envío se rechaza |

---

## 8. Información completada

```text
Información completada = round(preguntas aplicables respondidas / preguntas aplicables × 100)
```

- **Respondida** significa con un valor válido del catálogo o dentro de los límites de texto, aunque la respuesta sea desfavorable: “No todavía”, “Busca financiamiento”, “No lo sé aún”, “Por definir” o “No” cuentan.
- **Participan las 17 preguntas del formulario**, obligatorias y opcionales:
  - siempre: nombre, tipo, ubicación, descripción, tamaño, modalidad, inmueble, inversión, capital, plazo, decisor, calidad y experiencia (13);
  - con inmueble disponible: situación legal, propietarios y planos (+3);
  - con documentación disponible: lista de documentos (+1).
- **No participan:** archivos y enlace (material complementario, no preguntas) ni coordenadas o identificadores del proveedor de ubicación.
- La API devuelve `{score, answered, applicable, missingFields}`. `missingFields` explica qué falta.
- Se calcula al vuelo desde las respuestas guardadas, también para solicitudes históricas, sin persistencia propia.

Ejemplos: con todo respondido y sin inmueble, 13/13 = 100 %. Con inmueble y sin responder decisor, calidad, experiencia ni tamaño, 13/17 = 76 %.

---

## 9. Viabilidad financiera

**Regla de negocio.** No mide cantidad de dinero. Responde a:

> ¿El presupuesto y la disponibilidad declarados son razonablemente coherentes con el tipo, alcance, condiciones y expectativas del proyecto?

Debería producir una viabilidad alta para un proyecto pequeño con presupuesto bajo pero coherente, y baja para un presupuesto alto si el alcance declarado es todavía mayor o contradictorio.

**Estado: `PENDING_RULES`.** La API devuelve `{score: null, status: "PENDING_RULES"}` y el drawer muestra “Pendiente de reglas de evaluación” sin barra ni porcentaje. Se eligió no encapsular las reglas actuales como viabilidad provisional, por tres motivos:

- no consideran el tipo de proyecto ni la modalidad;
- una ausencia de hallazgos no demuestra viabilidad;
- un porcentaje derivado de ellas afirmaría una precisión que el sistema no tiene.

Las incoherencias financieras aprobadas siguen visibles como hallazgos `FINANCIAL` de la compatibilidad. El punto único para incorporar las reglas futuras es `evaluateFinancialViability`.

---

## 10. Cálculo, persistencia y contrato

| Aspecto | Comportamiento |
| --- | --- |
| Momento del cálculo de compatibilidad | Al enviar (`submitProjectRequest`), desde el registro guardado y los adjuntos reales (`hasFiles`). Se reevalúa en cada reenvío tras “Solicitar correcciones”. |
| Persistencia | `compatibility_score`, `compatibility_level`, `compatibility_reason_codes` (todas las evidencias) y `compatibility_scoring_version = "3.0"`. **Sin migración**: las columnas existentes admiten el nuevo contenido. |
| Completitud y viabilidad | Calculadas al vuelo en `toPublicProjectRequest` y en la cola técnica. No se persisten. |
| Evaluaciones históricas (`1.x`, `2.x`) | Conservan score, nivel y observaciones; `findings` es `null`. No se recalculan. |
| `ProjectRequest.compatibility` | `{score, level, observations, findings}` |
| `WorkflowRequest` | `compatibility: {score, level}`, más `completeness` y `financialViability` |
| Seguridad | El esquema es `strict`: el frontend no puede enviar puntaje, nivel, versión, hallazgos ni presencia de archivos. |

### Niveles (sin cambios)

| Resultado | Código | Etiqueta |
| ---: | --- | --- |
| 80–100 | `excellent` | Excelente compatibilidad |
| 60–79 | `high` | Buena compatibilidad |
| 40–59 | `medium` | Compatibilidad media |
| 20–39 | `low` | Baja compatibilidad |
| 0–19 | `poorly_defined` | Solicitud poco definida |

### Recomendación de reunión y workflow

- `SCHEDULE_MEETING` / `DO_NOT_SCHEDULE_MEETING` siguen siendo una decisión de revisión técnica: no se derivan de ninguna métrica ni las modifican.
- Aprobar, solicitar correcciones o rechazar siguen siendo decisiones administrativas: las métricas las informan, no las disparan.

---

## 11. Casos de ejemplo (fórmula 3.0)

Valores calculados con el motor real.

**Perfil común:**

- descripción válida;
- tamaño pequeño y modalidad “En su totalidad”;
- inmueble disponible, con documentación y planos;
- inversión de USD 10.000–50.000 y capital disponible ahora;
- inicio en 1–3 meses y calidad estándar;
- decisor, experiencia, un archivo y un enlace.

| Caso | Cambios sobre el perfil | Compatibilidad | Hallazgos | Información completada |
| --- | --- | ---: | --- | ---: |
| **A** — Proyecto pequeño coherente | Ninguno | 100 · Excelente | — | 100 % (17/17) |
| **B** — Proyecto grande incoherente | Grande, < USD 10.000, capital en 3 meses, inicio en 3–6 meses | 75 · Buena | `FINANCIAL_SCOPE_MISMATCH` (HIGH) | 100 % |
| **B2** — Misma brecha desde dos cruces | Muy grande, < USD 10.000, premium | 65 · Buena | `FINANCIAL_SCOPE_MISMATCH` (una sola, −35) | 100 % |
| **C** — Cliente sin inmueble | “No todavía” o “En proceso”, inicio en > 6 meses | 100 · Excelente | — (sección legal N/A) | 100 % (13/13) |
| **D** — Mucho presupuesto | > USD 150.000 y calidad de lujo | 100 · Excelente (igual que A) | — | 100 % |
| **D2** — Busca financiamiento | Busca financiamiento, inicio en 3–6 meses | 100 · Excelente | — | 100 % |
| **E** — Completo pero contradictorio | En proceso de adquisición, inicio inmediato, busca financiamiento, muy grande, lujo | 50 · Media | `FINANCIAL_SCOPE_MISMATCH` −25, `CAPITAL_TIMING_MISMATCH` −15, `PROPERTY_TIMING_MISMATCH` −10 | **100 %** (13/13) |
| **H** — Una causa financiera | Inversión no definida, muy grande, lujo, inicio inmediato | 80 · Excelente | `FINANCIAL_DEFINITION_INSUFFICIENT` (4 evidencias, −20) | 100 % |
| **I** — Opcionales sin responder | Sin tamaño, decisor, calidad, experiencia, archivos ni enlace | 78 · Buena | `PROJECT_SIZE_UNDEFINED`, `REFERENCE_FILES_MISSING`, `REFERENCE_LINK_MISSING` | 76 % (13/17) |

---

## 12. Datos que no puntúan

**Nunca afectan la compatibilidad:**

- nombre, tipo, ubicación y descripción;
- decisor y experiencia previa;
- disponibilidad del inmueble y del capital por sí solas;
- cantidad o tipo de documentos y número de propietarios;
- monto concreto de inversión;
- cantidad de archivos por encima de uno.

**Solo por coherencia:** plazo de inicio, calidad esperada, disponibilidad del capital y disponibilidad del inmueble.

Los textos de códigos históricos (`companyImmediate`, `companyCapitalUndefined`, `extendedFamilyImmediate`, `descriptionWeak`, `largeBudget10k50k`, `referencesMissingDescriptionWeak`, `sizeUnknownBudgetUndefined`) se conservan solo para mostrar evaluaciones antiguas.

---

## 13. Estado de las discrepancias de v2.2

| # | Discrepancia | Estado | Resolución |
| ---: | --- | --- | --- |
| D1 | El inmueble sumaba 10 / 5 / 0. | **RESUELTA** | Solo coherencia y aplicabilidad. |
| D2 | La sección legal N/A contaba como 0 sobre 100. | **RESUELTA** | Las reglas N/A no generan evidencia; la completitud excluye las preguntas N/A. Sin inmueble se alcanza 100. |
| D3 | El motor no aplicaba `hasAvailableProperty`. | **RESUELTA** | El motor aplica la regla de dominio y las pruebas usan datos realistas. |
| D4 | El capital valía 25 / 20 / 10 / 0. | **RESUELTA** | Solo coherencia con el plazo. |
| D5 | Una misma causa se penalizaba varias veces. | **RESUELTA** | Hallazgos consolidados por causa (sección 6.4). Los valores siguen pendientes de validación de negocio. |
| D6 | La descripción puntuaba por longitud. | **RESUELTA** | Informativa. La calidad semántica queda pendiente de definición. |
| D7 | Completitud y viabilidad eran prototipos fijos. | **PARCIAL** | Completitud real e integrada en el drawer. Viabilidad retirada del prototipo, pero en `PENDING_RULES`. |
| D8 | El tipo de proyecto no participa en la coherencia financiera. | **PENDIENTE** | Requiere la matriz de rangos por tipo. |
| D9 | Solo se persistían tres códigos. | **RESUELTA** | Se persisten y exponen todas las evidencias y hallazgos. |

---

## 14. Pendientes de negocio

1. **Matriz de viabilidad financiera:** rangos de inversión razonables por tipo, tamaño, calidad y modalidad, su relación con capital y plazo, y la escala del indicador (D7, D8).
2. **Magnitud de las deducciones:** validar los valores heredados de `v2.2` (−2 a −35). Por ejemplo, el caso B (gran alcance con presupuesto insuficiente) conserva “Buena compatibilidad” con 75.
3. **Severidades definitivas:** confirmar la clasificación LOW/MEDIUM/HIGH de cada evidencia, hoy alineada con la magnitud histórica.
4. **Información completada:** confirmar que las preguntas opcionales (tamaño, decisor, calidad, experiencia y planos) deben contar, y que archivos y enlace quedan fuera.
5. **Claridad de la descripción:** definir, si se desea, una regla objetiva. No se usará longitud ni IA.
6. **Sugerencias automáticas:** cualquier sugerencia de reunión o de acción derivada de las métricas debe ser una regla nueva y separada.

Todo cambio de pesos o reglas debe publicarse como una nueva versión de la fórmula, con pruebas de regresión, y conservar las evaluaciones históricas.
