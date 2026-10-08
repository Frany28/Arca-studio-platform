# Referencia técnica de evaluación de solicitudes de proyecto

La propuesta administrativa para aprobación está en [Propuesta V3](../SISTEMA_PUNTUACION_SOLICITUDES.md). Esta referencia documenta los contratos y el comportamiento implementado; los pesos se conservan y su validación final corresponde a la dirección.

> **Cómo leer este documento.** Describe la **regla de negocio** y su **implementación vigente, la fórmula `3.3`** (pesos de `3.0`; aplicabilidad del Stand publicitario corregida en `3.1`; referencias sin deducción desde `3.2`; planos sin deducción y tamaño condicionado a su estimabilidad desde `3.3`; ver secciones 17 a 19). La sección 13 registra el estado de cada discrepancia detectada en `v2.2` (D1–D9). Lo que todavía requiere una decisión humana figura en la sección 14 y no se completa con valores supuestos.

> **Alcance de la compatibilidad.** La compatibilidad mide la preparación y coherencia de una solicitud preliminar. No constituye una evaluación técnica definitiva ni determina la aceptación del proyecto. La información será revisada por el administrador y el arquitecto antes de crear un proyecto. La información pendiente no indica falta de seriedad ni de compromiso del cliente.

---

## 1. Objetivo

Una solicitud se evalúa con **tres métricas independientes**:

| Métrica | Qué responde | Estado |
| --- | --- | --- |
| **Compatibilidad** | ¿Lo respondido es claro, está preparado donde corresponde y es coherente? | Implementada (`3.3`). Se calcula y persiste al enviar. |
| **Información completada** | ¿Qué porcentaje de las preguntas aplicables se respondió? | Implementada. Se calcula al vuelo. |
| **Viabilidad financiera** | ¿Las condiciones financieras declaradas son coherentes con el proyecto solicitado? | Implementada como coherencia orientativa: un estado sin porcentaje (sección 9). |

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
| Viabilidad financiera: evaluador | `Backend/src/domain/projectRequestFinancialViability.js` |
| Viabilidad financiera: matriz relativa | `Backend/src/domain/projectRequestFinancialMatrix.js` |
| Composición de métricas derivadas | `Backend/src/domain/projectRequestEvaluation.js` |
| Validación del contrato | `Backend/src/validation/projectRequestSchemas.js` |
| Presentación de completitud y viabilidad | `Frontend/src/utils/projectRequestMetrics.js` |
| Pruebas | `Backend/tests/projectRequestScoring.test.js`, `Backend/tests/projectRequestCompleteness.test.js`, `Backend/tests/projectRequestFinancialViability.test.js` |

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
9. **No inventar pesos, porcentajes ni umbrales.** La fórmula `3.0` solo reutiliza pesos heredados en `v2.2`.

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
| **Puntúa** | Su ausencia o indefinición genera un hallazgo de preparación con su peso existente. Todas las respuestas definidas valen lo mismo. |
| **Solo coherencia** | Nunca suma. Solo participa cuando contradice otra respuesta. |
| **Informativa** | No afecta la compatibilidad. Sirve para contexto, contacto, personalización o revisión humana. |
| **Condicional** | Solo se evalúa si otra respuesta hace que aplique. Si no aplica es N/A (sección 5). |

### Matriz de preguntas (fórmula 3.3)

| # | Pregunta | ¿Aplica siempre? | Obligatoria | Tipo | Efecto en compatibilidad | En “Información completada” |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Nombre del proyecto | Sí | Sí | Informativa | Ninguno | Sí |
| 2 | Tipo de proyecto | Sí | Sí | Informativa | Ninguno (sin diferenciación económica aprobada) | Sí |
| 3 | Ubicación del proyecto | Sí | Sí | Informativa | Ninguno | Sí |
| 4 | Descripción del proyecto | Sí | Sí (30–100 caracteres) | Informativa | Ninguno: la longitud ya no puntúa | Sí |
| 5 | Tamaño aproximado | Sí | No | Puntúa + coherencia | “No lo sé aún” o sin responder: `PROJECT_SIZE_UNDEFINED` (−15) solo si el tamaño es estimable (inmueble disponible; en stands, espacio asignado con medidas). Se cruza con la inversión. | Sí |
| 6 | ¿Cómo desea desarrollar el proyecto? | Sí | Sí | Puntúa + coherencia | “Por definir”: `EXECUTION_MODE_UNDEFINED` (−10, una vez aunque el inicio sea inmediato) | Sí |
| 7 | ¿Tiene terreno o inmueble disponible? | Sí | Sí | Solo coherencia + controla aplicabilidad | Ninguno por sí solo. Se cruza con el plazo de inicio. | Sí |
| 8 | Situación legal del inmueble | No | Sí, si #7 = “Sí, disponible” | Condicional (preparación) | En trámite −3 / no dispone −6 (`LEGAL_DOCUMENTATION_PENDING`) | Si aplica |
| 9 | Documentación disponible | No | Sí, si #8 = disponible | Condicional · Informativa | Ninguno; la cantidad o el tipo no suman | Si aplica |
| 10 | ¿Más de un propietario? | No | Sí, si #7 = “Sí, disponible” | Condicional · Informativa | Ninguno | Si aplica |
| 11 | ¿Dispone de planos del lugar? | No | No | Condicional · Informativa | Ninguno desde 3.3 (antes `BLUEPRINTS_UNAVAILABLE`, −2). «No» o sin respuesta generan una observación para administración sin puntos. | Si aplica |
| 12 | Rango de inversión estimado | Sí | Sí | Puntúa + coherencia | No definido: `FINANCIAL_DEFINITION_INSUFFICIENT` (una sola deducción). Definido: solo coherencia. | Sí |
| 13 | Disponibilidad del capital | Sí | Sí | Solo coherencia | Ninguno por sí solo. Se cruza con el plazo (`CAPITAL_TIMING_MISMATCH`). | Sí |
| 14 | ¿Cuándo espera iniciar? | Sí | Sí | Solo coherencia | Ninguno por sí solo | Sí |
| 15 | ¿Quién toma la decisión final? | Sí | No | Informativa | Ninguno | Sí |
| 16 | Expectativa de calidad | Sí | No | Solo coherencia | Ninguno por sí sola. Se cruza con la inversión. | Sí |
| 17 | ¿Ha trabajado con un arquitecto o diseñador? | Sí | No | Informativa | Ninguno: la experiencia no hace mejor ni peor al cliente | Sí |
| 18 | Imágenes o archivos | Sí | No | Informativa | Ninguno desde 3.2 (antes `REFERENCE_FILES_MISSING`, −5) | No (material complementario) |
| 19 | Link de referencia | Sí | No | Informativa | Ninguno desde 3.2 (antes `REFERENCE_LINK_MISSING`, −2) | No (material complementario) |

---

## 4. Variables retiradas de la puntuación

| Variable | Peso en v2.2 | Fórmula 3.0 | Motivo |
| --- | ---: | --- | --- |
| Terreno o inmueble disponible | 10 / 5 / 0 | Solo coherencia y aplicabilidad | No premiar tener inmueble (D1). |
| Disponibilidad del capital | 25 / 20 / 10 / 0 | Solo coherencia con el plazo | No premiar condiciones económicas (D4). |
| Longitud de la descripción | 10 / 4 | Informativa | La longitud no demuestra claridad (D6). No existe evaluación semántica ni mediante IA. |

---

## 5. Reglas condicionales y no aplicabilidad

### 5.1. Terreno o inmueble disponible

| Respuesta | Sección legal | Preguntas #8–#11 |
| --- | --- | --- |
| Sí, disponible | Se muestra | Aplican |
| En proceso de adquirirlo | No se muestra | **N/A** |
| No todavía | No se muestra | **N/A** |
| *(Stand publicitario: la pregunta no aplica)* | No se muestra | **N/A** |

- **Stand publicitario (3.1):** se monta en el espacio que asigna el evento, no en un inmueble del cliente. La pregunta del terreno o inmueble y toda la sección legal son N/A; el espacio se declara en «Requisitos del stand» y no hereda deducciones del inmueble.
- **Frontend:** oculta la pregunta en un stand, oculta la sección y limpia los valores al cambiar el tipo o la respuesta.
- **Backend:** exige `landStatus` salvo en Stand publicitario, donde lo rechaza; rechaza datos legales, de propietarios o de planos cuando el inmueble no aplica o no está disponible.
- **Motor (D3 resuelto):** aplica la misma regla, `hasApplicableProperty`, aunque llegaran datos residuales: sin inmueble aplicable y disponible, esas reglas no se evalúan.
- **Paridad:** el dominio (`Backend/src/domain/projectRequest.js`) y su réplica en el frontend (`Frontend/src/utils/projectRequestApplicability.js`) se comparan en todas las combinaciones en `Backend/tests/projectRequestApplicability.test.js`.

La documentación disponible (#9) solo aplica si la situación legal es “disponible”. Si se declara disponible sin seleccionar ningún tipo, el contrato rechaza el envío; en registros incompletos el motor conserva el tratamiento defensivo de no disponible. Seleccionar un tipo es una declaración, no acredita ni verifica documentos.

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
- **Pesos:** los valores de deducción son los heredados de `v2.2`; `3.0` no introduce cantidades nuevas. Lo que cambia es que cada causa resta una vez y que la base retirada (sección 4) ya no resta.

#### Por qué una escala de 100 con deducciones y no un cociente

Se evaluó normalizar como `puntos obtenidos aplicables / máximo aplicable`. Tras retirar 45 puntos de base (D1, D4, D6), el cociente multiplicaba por ~2,1 el peso efectivo de cada criterio restante. Por ejemplo, “tamaño no definido” pasaría de restar 15 a restar 32. Eso equivale a introducir pesos nuevos.

La escala con deducciones conserva el impacto existente de cada criterio sobre una base fija de 100. Cumple la regla de no aplicabilidad porque un criterio N/A nunca genera evidencia; solo las preguntas aplicables pueden reducir el resultado.

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
| `PROJECT_SIZE_UNDEFINED` | SCOPE | `projectSizeUndefined` 15 M | 15, solo con tamaño estimable (3.3) |
| `EXECUTION_MODE_UNDEFINED` | SCOPE | `developmentModeUndefined` 10 M · `modeUndefinedImmediate` 10 M | 10 |
| `LEGAL_DOCUMENTATION_PENDING` | LEGAL | `legalDocumentationUnavailable` 6 L · `legalDocumentationInProcess` 3 L | 3–6 (solo con inmueble) |
| `BLUEPRINTS_UNAVAILABLE` | INFORMATION | `blueprintsUnavailable` 2 L | **Retirada en 3.3**: solo se lee en evaluaciones 3.0–3.2 guardadas |
| `REFERENCE_FILES_MISSING` | INFORMATION | `referenceFilesMissing` 5 L | **Retirada en 3.2**: solo se lee en evaluaciones 3.0/3.1 guardadas |
| `REFERENCE_LINK_MISSING` | INFORMATION | `referenceLinkMissing` 2 L | **Retirada en 3.2**: solo se lee en evaluaciones 3.0/3.1 guardadas |

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
- **Participan las preguntas del formulario que aplican**, obligatorias y opcionales (21 posibles):
  - siempre: nombre, tipo, ubicación, descripción, tamaño, modalidad, inversión, capital, plazo, decisor, calidad y experiencia (12);
  - excepto en Stand publicitario: terreno o inmueble (+1);
  - con inmueble aplicable y disponible: situación legal, propietarios y planos (+3);
  - con documentación legal disponible: lista de documentos (+1);
  - en Stand publicitario: normas del evento, espacio asignado y medidas o plano del espacio (+3);
  - con normas del evento disponibles («Sí, tengo los requisitos»): documentación del evento (+1).
- Las respuestas negativas válidas cuentan como respondidas; una respuesta ausente o una lista de documentos vacía cuando aplica cuenta como incompleta. Las preguntas del stand no puntúan en compatibilidad ni en coherencia financiera.
- **No participan:** archivos y enlace (material complementario, no preguntas) ni coordenadas o identificadores del proveedor de ubicación.
- La API devuelve `{score, answered, applicable, missingFields}`. `missingFields` explica qué falta; las preguntas del stand usan la ruta del bloque (`standRequirements.requirementsStatus`, `standRequirements.documentTypes`, `standRequirements.spaceStatus`, `standRequirements.hasSpacePlans`).
- Se calcula al vuelo desde las respuestas guardadas, también para solicitudes históricas, sin persistencia propia. Un Stand publicitario sin bloque guardado (registro que nunca recibió la sección) deja sus preguntas N/A: no recibe respuestas ficticias ni penalización.

Ejemplos: con todo respondido y sin inmueble, 13/13 = 100 %. Con inmueble y sin responder decisor, calidad, experiencia ni tamaño, 13/17 = 76 %. Stand con normas disponibles y documentación seleccionada, 16/16 = 100 %; sin normas, 15/15 = 100 %; con normas disponibles sin seleccionar documentación, 15/16 = 94 %.

---

## 9. Viabilidad financiera (coherencia financiera orientativa)

### 9.1. Qué evalúa y qué no

Evalúa la **coherencia económica observable** entre las respuestas del cliente:

> ¿El presupuesto y la disponibilidad declarados son razonablemente coherentes con el alcance, las expectativas y el plazo del proyecto?

**No** evalúa si el dinero alcanza para ejecutar la obra. Sin precios de referencia, y sin saber si el presupuesto cubre solo el diseño o también la ejecución, el sistema no puede afirmar que un presupuesto sea suficiente o insuficiente. Solo puede señalar combinaciones que conviene aclarar.

| Usa | No usa |
| --- | --- |
| `investmentRange` (rango de inversión) | Tipo de proyecto: no hay diferenciación económica aprobada (D8) |
| `projectSize` (tamaño) | Ubicación, descripción, inmueble, sección legal, decisor y experiencia |
| `quality` (calidad esperada) | Precios de mercado, servicios externos o IA |
| `developmentMode` (solo para contextualizar qué cubre el presupuesto) | Operaciones aritméticas entre niveles de rango o tamaño |
| `capitalAvailability` y `startTime` | |

El formulario **no tiene** una modalidad “diseño / ejecución / diseño y ejecución”. `developmentMode` solo indica si el proyecto se desarrollará por fases, en su totalidad o por definir. Por eso, qué cubre el presupuesto se trata como una **incertidumbre explícita** (hallazgo `BUDGET_COVERAGE_UNSPECIFIED`), y ninguna combinación presupuesto–alcance se clasifica como riesgo elevado.

### 9.2. Matriz relativa

Los rangos y tamaños se usan como **niveles relativos**, con sus límites y orden originales. Cada celda declara su resultado explícitamente; no se suman ni restan niveles. Las celdas con evidencia reutilizan combinaciones que la compatibilidad 3.0 ya identifica para revisión. Fuente: `Backend/src/domain/projectRequestFinancialMatrix.js`.

**Tamaño × inversión**

| Tamaño \ Inversión | < USD 10.000 | USD 10.000–50.000 | USD 50.000–150.000 | > USD 150.000 |
| --- | --- | --- | --- | --- |
| Pequeño (< 80 m²) | Sin conflicto | Sin conflicto | Sin conflicto | Sin conflicto |
| Mediano (80–200 m²) | Revisión (`mediumBudgetUnder10k`) | Sin conflicto | Sin conflicto | Sin conflicto |
| Grande (200–500 m²) | Revisión (`largeBudgetUnder10k`) | Sin conflicto | Sin conflicto | Sin conflicto |
| Muy grande (> 500 m²) | Revisión (`veryLargeBudgetUnder10k`) | Revisión (`veryLargeBudget10k50k`) | Sin conflicto | Sin conflicto |
| No lo sé aún | No comparable | No comparable | No comparable | No comparable |

**Calidad × inversión**

| Calidad \ Inversión | < USD 10.000 | USD 10.000–50.000 | USD 50.000–150.000 | > USD 150.000 |
| --- | --- | --- | --- | --- |
| Funcional y económico | Sin conflicto | Sin conflicto | Sin conflicto | Sin conflicto |
| Calidad estándar | Sin conflicto | Sin conflicto | Sin conflicto | Sin conflicto |
| Premium | Revisión (`premiumBudgetUnder10k`) | Sin conflicto | Sin conflicto | Sin conflicto |
| Exclusivo/lujo | Revisión (`luxuryBudgetUnder10k`) | Revisión (`luxuryBudget10k50k`) | Sin conflicto | Sin conflicto |
| Sin responder | No comparable | No comparable | No comparable | No comparable |

**Disponibilidad del capital × plazo de inicio**

| Capital \ Inicio | De inmediato | 1–3 meses | 3–6 meses | Más de 6 meses |
| --- | --- | --- | --- | --- |
| Disponible ahora | Sin conflicto | Sin conflicto | Sin conflicto | Sin conflicto |
| En los próximos 3 meses | Revisión (`capitalWithin3MonthsImmediate`) | Sin conflicto | Sin conflicto | Sin conflicto |
| Busca financiamiento | Revisión (`financingImmediate`) | Revisión (`financingSoon`) | Sin conflicto | Sin conflicto |
| Indefinido | **Riesgo elevado** (`capitalUndefinedImmediate`) | Revisión (`capitalUndefinedSoon`) | Informativo (`capitalAvailabilityUncertain`) | Informativo (`capitalAvailabilityUncertain`) |

**Entradas de contexto**

| Condición | Resultado |
| --- | --- |
| Inversión “No lo tengo definido aún” | Datos insuficientes (`investmentRangeUndefined`) |
| Inversión definida, pero sin tamaño comparable ni calidad | Datos insuficientes (`financialScopeUndefined`) |
| Alguna celda de revisión presupuesto–alcance o presupuesto–calidad | Informativo: `budgetMayCoverPhase` si el proyecto es por fases; `budgetCoverageUnspecified` en otro caso |

### 9.3. Justificación de las clasificaciones

- **Sin conflicto:** ninguna regla vigente observa la combinación. Un presupuesto mayor nunca mejora una celda, y un proyecto pequeño nunca se observa por tener un presupuesto bajo.
- **Revisión:** las 12 combinaciones que la compatibilidad ya identifica para revisión. Las de presupuesto–alcance y presupuesto–calidad no suben a riesgo elevado porque se desconoce qué cubre el presupuesto. Una preferencia de lujo no basta como prueba de inviabilidad.
- **Riesgo elevado:** solo “capital indefinido + inicio inmediato”. Es una dependencia económica fuerte (severidad `HIGH` vigente) que no depende de qué cubra el presupuesto: el cliente no sabe cuándo dispondrá del capital y quiere empezar ya.
- **Buscar financiamiento** no se penaliza por sí solo: con un plazo de 3–6 meses o más no genera hallazgos. **“Disponible ahora”** es una declaración del cliente: no es una verificación ni equivale a un financiamiento aprobado.
- **Capital indefinido con plazo flexible:** no se asume solvencia ni insolvencia; solo se informa la incertidumbre.
- Una prueba exhaustiva verifica que la matriz y el motor de compatibilidad 3.0 detecten exactamente las mismas evidencias en todas las combinaciones reales.

### 9.4. Estados

| Estado | Significado | Etiqueta en el drawer |
| --- | --- | --- |
| `NO_OBVIOUS_CONFLICT` | No se detectan contradicciones con las reglas disponibles. **No es una aprobación financiera.** | Sin incoherencias financieras detectadas (tono neutral, con aclaración) |
| `REVIEW_REQUIRED` | Una combinación debe aclararla un administrador. | Requiere revisión financiera (tono `warning`) |
| `HIGH_RISK` | Señal fuerte de dependencia económica. **No demuestra inviabilidad.** | Riesgo financiero elevado (tono `danger`, con aclaración) |
| `INSUFFICIENT_DATA` | Faltan respuestas para contrastar el presupuesto con el alcance. | Información financiera insuficiente |
| `PENDING_RULES` | Reservado para reglas sin configurar; las reglas actuales no lo producen. | Pendiente de reglas de evaluación |

El estado global es el efecto más fuerte entre sus hallazgos: `HIGH_RISK` > `REVIEW_REQUIRED` > `INSUFFICIENT_DATA` > sin conflicto. Los hallazgos `INFORMATIVE` explican el contexto sin cambiar el estado.

### 9.5. Contrato

```js
financialViability: {
  score: null,
  status: "REVIEW_REQUIRED",
  findings: [
    {
      code: "FINANCIAL_SCOPE_MISMATCH",   // causa (mismo código que en compatibilidad)
      category: "FINANCIAL",              // o "TEMPORAL" para capital × plazo
      severity: "HIGH",                   // LOW | MEDIUM | HIGH
      outcome: "REVIEW_REQUIRED",         // HIGH_RISK | REVIEW_REQUIRED | INSUFFICIENT_DATA | INFORMATIVE
      explanation: "El rango de inversión requiere revisión para el tamaño grande indicado.",
      evidence: [{ code: "largeBudgetUnder10k", explanation: "..." }]
    }
  ]
}
```

- **Por qué `score` es `null`:** no existe una escala porcentual validada. Un porcentaje afirmaría una precisión que el sistema no tiene.
- **Sin doble penalización:** la métrica financiera no aplica deducciones. Reutiliza las causas y evidencias de la compatibilidad 3.0, que ya descuenta cada causa una sola vez. Calcularla no modifica el score de compatibilidad ni la completitud.
- **Agrupación:** varias evidencias de una misma causa forman un único hallazgo con el efecto y la severidad más fuertes.
- **Sin persistencia:** se recalcula al vuelo con las reglas vigentes, tanto para solicitudes nuevas como antiguas, porque solo depende de las respuestas guardadas. No se modifica ningún dato.

### 9.6. Incorporar rangos económicos reales en el futuro

1. Si el negocio lo aprueba, añadir al formulario lo que hoy falta: qué cubre el presupuesto (diseño, ejecución o ambos).
2. Aprobar rangos por tipo de proyecto y tamaño (D8) y expresarlos como nuevas matrices o filas en `projectRequestFinancialMatrix.js`.
3. Solo entonces, evaluar `HIGH_RISK` en las celdas presupuesto–alcance y definir una escala para `score`.
4. Si el resultado llegara a persistirse, guardar la versión de las reglas junto al estado para no alterar evaluaciones anteriores.

---

## 10. Cálculo, persistencia y contrato

| Aspecto | Comportamiento |
| --- | --- |
| Momento del cálculo de compatibilidad | Al enviar (`submitProjectRequest`), desde las respuestas guardadas; desde 3.2 los adjuntos no participan. Se reevalúa en cada reenvío tras “Solicitar correcciones”. |
| Persistencia | `compatibility_score`, `compatibility_level`, `compatibility_reason_codes` (todas las evidencias) y `compatibility_scoring_version = "3.3"` en los envíos nuevos. **Sin migración**: las columnas existentes admiten el nuevo contenido. |
| Completitud y viabilidad | Calculadas al vuelo en `toPublicProjectRequest` y en la cola técnica. No se persisten. |
| Evaluaciones `3.0`, `3.1` y `3.2` | Conservan score, nivel, versión y motivos guardados; `findings` se reconstruye con el catálogo vigente más las evidencias retiradas (`referenceFilesMissing`, `referenceLinkMissing`, `blueprintsUnavailable`). No se recalculan, aunque incluyan deducciones que la versión vigente ya no aplica. |
| Evaluaciones históricas (`1.x`, `2.x`) | Conservan score, nivel y observaciones; `findings` es `null`. No se recalculan. |
| `ProjectRequest.compatibility` | `{score, level, observations, findings}` |
| `WorkflowRequest` | `compatibility: {score, level}`, más `completeness`, `financialViability` y `reviewObservations` (observaciones sin puntos, sección 19) |
| `financialViability` | `{score: null, status, findings}` (sección 9.5), en `ProjectRequest` y en `WorkflowRequest` |
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

## 11. Casos de ejemplo (fórmula 3.3)

Valores calculados con el motor real. Con el perfil común (que incluye archivo, enlace, inmueble disponible y planos) los resultados no cambian respecto de 3.0; solo cambia el caso I. Los cambios de 3.3 se muestran en la sección 19.

**Perfil común:**

- descripción válida;
- tamaño pequeño y modalidad “En su totalidad”;
- inmueble disponible, con documentación y planos;
- inversión de USD 10.000–50.000 y capital disponible ahora;
- inicio en 1–3 meses y calidad estándar;
- decisor, experiencia, un archivo y un enlace.

| Caso | Cambios sobre el perfil | Compatibilidad | Hallazgos | Información completada | Viabilidad financiera |
| --- | --- | ---: | --- | ---: | --- |
| **A** — Proyecto pequeño coherente | Ninguno | 100 · Excelente | — | 100 % (17/17) | `NO_OBVIOUS_CONFLICT` |
| **B** — Proyecto grande incoherente | Grande, < USD 10.000, capital en 3 meses, inicio en 3–6 meses | 75 · Buena | `FINANCIAL_SCOPE_MISMATCH` (HIGH) | 100 % | `REVIEW_REQUIRED` |
| **B2** — Misma brecha desde dos cruces | Muy grande, < USD 10.000, premium | 65 · Buena | `FINANCIAL_SCOPE_MISMATCH` (una sola, −35) | 100 % | `REVIEW_REQUIRED` (un hallazgo, 2 evidencias) |
| **C** — Cliente sin inmueble | “No todavía” o “En proceso”, inicio en > 6 meses | 100 · Excelente | — (sección legal N/A) | 100 % (13/13) | `NO_OBVIOUS_CONFLICT` |
| **D** — Mucho presupuesto | > USD 150.000 y calidad de lujo | 100 · Excelente (igual que A) | — | 100 % | `NO_OBVIOUS_CONFLICT` (igual que A) |
| **D2** — Busca financiamiento | Busca financiamiento, inicio en 3–6 meses | 100 · Excelente | — | 100 % | `NO_OBVIOUS_CONFLICT` |
| **E** — Completo pero contradictorio | En proceso de adquisición, inicio inmediato, busca financiamiento, muy grande, lujo | 50 · Media | `FINANCIAL_SCOPE_MISMATCH` −25, `CAPITAL_TIMING_MISMATCH` −15, `PROPERTY_TIMING_MISMATCH` −10 | **100 %** (13/13) | `REVIEW_REQUIRED` |
| **H** — Una causa financiera | Inversión no definida, muy grande, lujo, inicio inmediato | 80 · Excelente | `FINANCIAL_DEFINITION_INSUFFICIENT` (4 evidencias, −20) | 100 % | `INSUFFICIENT_DATA` |
| **J** — Capital indefinido e inicio inmediato | Capital “Indefinido”, inicio inmediato | 80 · Excelente | `CAPITAL_TIMING_MISMATCH` −20 | 100 % | `HIGH_RISK` |
| **I** — Opcionales sin responder | Sin tamaño, decisor, calidad, experiencia, archivos ni enlace | 85 · Excelente (78 · Buena en 3.0/3.1) | `PROJECT_SIZE_UNDEFINED` | 76 % (13/17) | `INSUFFICIENT_DATA` (sin tamaño ni calidad) |

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
| D6 | La descripción puntuaba por longitud. | **RESUELTA** | Informativa. No se evalúa claridad mediante longitud ni IA. |
| D7 | Completitud y viabilidad eran prototipos fijos. | **PARCIAL** | Completitud real. La viabilidad se implementó como coherencia orientativa, con estados y motivos (sección 9); la viabilidad basada en rangos económicos reales sigue pendiente. |
| D8 | El tipo de proyecto no participa en la coherencia financiera. | **PENDIENTE** | No hay diferenciación económica aprobada por tipo; la matriz relativa no lo usa (sección 9.6). |
| D9 | Solo se persistían tres códigos. | **RESUELTA** | Se persisten y exponen todas las evidencias y hallazgos. |

---

## 14. Pendientes de negocio

1. **Viabilidad financiera con rangos reales:** rangos por tipo y tamaño (D8), qué cubre el presupuesto (diseño, ejecución o ambos) y, solo después, una escala porcentual (D7).
2. **Clasificaciones de la matriz relativa:** confirmar que las 12 combinaciones observadas son `REVIEW_REQUIRED`; que solo “capital indefinido + inicio inmediato” es `HIGH_RISK`; y que mediano o grande con USD 10.000–50.000, y premium con USD 10.000–50.000, se consideran sin conflicto.
3. **Magnitud de las deducciones:** validar los valores heredados de `v2.2` (−2 a −35). Por ejemplo, el caso B (gran alcance con presupuesto insuficiente) conserva “Buena compatibilidad” con 75.
4. **Severidades definitivas:** confirmar la clasificación LOW/MEDIUM/HIGH de cada evidencia, hoy alineada con la magnitud histórica.
5. **Información completada:** confirmar que las preguntas opcionales (tamaño, decisor, calidad, experiencia y planos) deben contar, y que archivos y enlace quedan fuera.
6. **Requisitos del stand:** desde `3.1` sus cuatro preguntas cuentan en información completada (sección 17). Cualquier incorporación a la puntuación de compatibilidad, incluida una regla de espacio del evento frente al inicio, requiere una regla expresa, aprobación, una nueva versión y pruebas.
7. **Sugerencias automáticas:** cualquier sugerencia de reunión o de acción derivada de las métricas debe ser una regla nueva y separada.

Todo cambio de pesos o reglas debe publicarse como una nueva versión de la fórmula, con pruebas de regresión, y conservar las evaluaciones históricas.


## 15. Consolidación funcional V3 — 8 de octubre de 2026

- Descripción: 30–100 caracteres recortados, sin puntos por longitud; una respuesta válida cuenta en completitud.
- Inmueble: solo `landStatus === "available"` activa situación legal, propietarios y planos. Se conservan −3/−6 por documentación y −2 por planos; no se premian tipos, cantidad de documentos ni propietarios.
- Stand: solo `advertising_stand`; `stands_exhibitions` conserva su significado en registros históricos y se retira de nuevas solicitudes. El bloque `standRequirements` está implementado y persistido, consultable por administración y excluido de las tres métricas. La respuesta de asignación del espacio conserva su validación obligatoria; las normativas pueden no estar disponibles. Los planos del espacio del evento son independientes de `hasPlans`.
- Completitud: catálogo sin cambios; 13 preguntas generales, +3 con inmueble disponible, +1 con documentación disponible. No se agregan las cuatro preguntas del stand.
- No se cambian el catálogo de deducciones, sus categorías, severidades, umbrales ni versión 3.0. La compatibilidad histórica persistida conserva resultado y observaciones; las dos métricas derivadas mantienen su cálculo al vuelo. No hay nuevas migraciones ni recalificación masiva.
- Implementado: secciones legal y stand, limpieza condicional, validación en crear/editar, persistencia nullable, presentación administrativa, tres métricas y trazabilidad. Pendiente de aprobación: pesos finales o reglas nuevas, incorporación del stand a completitud/puntuación y diferenciación económica por tipo.

### Cobertura de aceptación

`projectRequestValidation.test.js` y `projectRequestEvaluationContract.test.js` comprueban límites y paridad frontend/API; el segundo recorre la lectura del repositorio con transporte PostgreSQL simulado hasta las métricas públicas, incluidas las combinaciones independientes de planos del inmueble y del evento. `projectRequestScoring.test.js`, `projectRequestCompleteness.test.js`, `projectRequestFinancialViability.test.js` y `projectRequestStand.test.js` cubren los pesos existentes, las causas únicas, N/A, ausencia de bonificaciones, historial, estados financieros y exclusión informativa. El formulario y el detalle administrativo se verifican con las suites de navegador `projectRequestForm.test.js` y `projectRequestWorkflow.test.js`.

### Validación de esta consolidación

- 63 pruebas específicas de contratos, compatibilidad, completitud, coherencia financiera y stands: todas pasan. La prueba nueva recorre combinaciones de tipo, inmueble, documentación y planos; también comprueba todas las longitudes válidas de descripción y los límites inválidos.
- `pnpm verify`: pasa JSDoc, validación de Prisma, pruebas de backend/frontend y compilación del frontend.
- 51 pruebas de navegador del formulario y workflow: todas pasan; incluyen 375/768/1440 px, ambos temas, visibilidad exclusiva, limpieza, restauración, confirmación y consulta administrativa.
- Los ejemplos administrativos coinciden con el motor real en 19 variantes, incluidos los dos límites de descripción.
- En esta validación inicial se omitieron cuatro integraciones PostgreSQL optativas por su configuración: repositorios reales del stand, migración en base local aislada, recomendación de reunión y detalle de cliente. Las pruebas de repositorios, reunión y detalle requieren sus flags explícitos; la migración aislada requiere una URL de pruebas local que no está configurada. Esta consolidación no cambia estructura ni persistencia, y no ejecuta migraciones ni recalcula solicitudes guardadas. La aplicación previa de la migración del stand en staging está registrada en [requisitos del stand](PROJECT_REQUEST_STAND_REQUIREMENTS.md).

## 16. Unificación del catálogo vigente

El catálogo seleccionable contiene `residential`, `commercial`, `corporate` y `advertising_stand`. `stands_exhibitions` era una opción persistible, no una agrupación visual; se retira de nuevas solicitudes y de ambos selectores existentes. Permanece en el catálogo de lectura y en el enum PostgreSQL para preservar registros anteriores, sin equipararlo a Stand publicitario.

El esquema de creación admite únicamente tipos vigentes. El esquema de edición admite los identificadores legibles y el servicio comprueba el registro autorizado: un tipo retirado solo puede conservarse si ya es el de esa solicitud. El formulario muestra la etiqueta histórica guardada sin ofrecerla en el menú y permite elegir un tipo vigente. La cola y el detalle administrativo conservan su representación. Las respuestas del stand solo aplican a `advertising_stand`.

Completitud utiliza el catálogo de tipos legibles para que retirar una opción no convierta solicitudes históricas en incompletas. No se modifican preguntas, fórmula, pesos, clasificaciones ni coherencia financiera. La compatibilidad persistida se conserva al leer y editar; un reenvío por correcciones mantiene su evaluación habitual 3.0 y no convierte el tipo.

No se requiere una migración: ambos valores ya existen en el enum compartido por solicitudes y proyectos. Las consultas previas encontraron nueve solicitudes (cinco residenciales y cuatro comerciales) y seis proyectos residenciales; ninguna fila utiliza `stands_exhibitions`. Se conserva el valor igualmente para compatibilidad. La comparación de contenido completo antes y después confirmó que las nueve solicitudes originales permanecen idénticas.

Validación de la unificación:

- 69 pruebas específicas de contratos y métricas: pasan; incluyen conservación y rechazo condicional del tipo retirado, lectura administrativa y reenvío.
- `pnpm verify` con `ARCA_STAND_REPOSITORY_DB_TESTS=1`: pasan 179 pruebas de backend y 272 de frontend, JSDoc, Prisma y compilación.
- La integración real de PostgreSQL simula un tipo histórico dentro de una transacción, verifica lectura, edición y cola sin alterar la evaluación guardada y revierte todos los datos de prueba.
- 53 pruebas de navegador del formulario y workflow: pasan; incluyen menú sin la opción retirada, edición histórica, presentación administrativa y responsive en ambos temas. `pnpm --dir Frontend lint` pasa.
- Tres integraciones optativas quedan omitidas: migración aislada por ausencia de URL local; recomendación de reunión y detalle del cliente por flags desactivados, ajenas a este cambio.

No se ejecutan migraciones, conversiones masivas ni commits. Deben desplegarse juntos frontend y backend para que los clientes utilicen el catálogo vigente de creación.

### Archivos de la unificación

| Área | Archivos modificados |
| --- | --- |
| Dominio backend | `Backend/src/domain/projectRequest.js`, `projectRequestCompleteness.js`, `projectRequestStand.js` |
| Validación y servicio | `Backend/src/validation/projectRequestSchemas.js`, `Backend/src/services/projectRequestService.js` |
| Catálogo y validación frontend | `Frontend/src/utils/projectRequestOptions.js`, `projectRequestValidation.js`, `projectTypeDisplay.js` |
| Formulario | `Frontend/src/pages/ProjectRequestPage.jsx`, `Frontend/src/pages/project-request/hooks/useProjectRequestForm.js`, `Frontend/src/pages/project-request/components/ProjectRequestFormFields.jsx` |
| Selector alternativo existente | `Frontend/src/components/ui/ProjectRequestModal.jsx`, `Frontend/src/components/ui/ProjectRequestFlow/ProjectRequestDetailsStep.jsx` |
| Pruebas backend | `Backend/tests/projectRequestTypes.test.js` (nuevo), `Backend/tests/projectRequestStand.integration.test.js` |
| Pruebas frontend | `Frontend/tests/projectRequestStand.test.js`, `Frontend/tests/browser/projectRequestForm.test.js`, `Frontend/tests/browser/projectRequestWorkflow.test.js` |
| Documentación | `SISTEMA_PUNTUACION_SOLICITUDES.md`, `docs/API_CONTRACT.md`, `docs/PROJECT_REQUEST_STAND_REQUIREMENTS.md`, este documento |

## 17. Fase 1 — aplicabilidad del stand y completitud (fórmula 3.1)

**Problema.** En `3.0` la aplicabilidad del inmueble dependía solo de `landStatus`. Un Stand publicitario respondía «¿Tiene terreno o inmueble disponible?» sobre un recinto que no le pertenece y podía recibir `PROPERTY_TIMING_MISMATCH` (−10/−20) y, con «Sí, disponible», las deducciones legal (−3/−6) y de planos (−2). Sus cuatro preguntas propias quedaban fuera de la información completada.

**Cambio.** Sustituye las afirmaciones de la sección 15 sobre el stand.

- `advertising_stand` sigue vigente; `stands_exhibitions` conserva su lectura y su catálogo anterior (inmueble aplicable y sin preguntas del stand).
- En Stand publicitario, la pregunta del inmueble y la sección legal son N/A en formulario, contrato, completitud y motor. La API rechaza `landStatus` y los datos legales para ese tipo; en los demás tipos `landStatus` sigue siendo obligatorio.
- El espacio asignado se conserva para la revisión administrativa, sin deducciones. No se crean reglas, pesos ni umbrales nuevos.
- Completitud incorpora condicionalmente normas del evento, documentación del evento (solo con «Sí, tengo los requisitos»), espacio asignado y medidas o plano del espacio.
- Coherencia financiera no cambia.

**Versión.** Como el resultado numérico cambia para stands nuevos, la fórmula pasa a `3.1`. Para los demás tipos, `3.0` y `3.1` producen el mismo resultado. Ambas comparten el catálogo de evidencias y reconstruyen hallazgos.

| Caso (resto del perfil preparado) | 3.0 | 3.1 |
| --- | --- | --- |
| Stand, «No todavía», inicio inmediato | 80 (−20), completitud 13/13 | 100, completitud 16/16 |
| Stand, «En proceso de adquirirlo», inicio inmediato | 90 (−10) | 100 |
| Stand, «Sí, disponible», sin documentación ni planos | 92 (−6 −2), 16/16 | 100, 16/16 |
| Stand, normas disponibles sin documentación seleccionada | 100, 13/13 | 100, 15/16 (94 %) |
| Stand, capital indefinido e inicio inmediato | 80 (−20) | 80 (−20), sin cambios |
| Residencial, «No todavía», inicio inmediato | 80 (−20) | 80 (−20), sin cambios |

**Históricos.** La compatibilidad guardada no se recalcula y conserva puntuación, nivel, versión y motivos. Un reenvío tras correcciones se evalúa con `3.1`. La completitud es dinámica:

- El bloque `standRequirements` es obligatorio desde que existe el tipo y sus cuatro preguntas se formulaban desde entonces, por lo que contarlas no penaliza información no solicitada.
- Un stand sin bloque guardado deja sus preguntas N/A.
- El `landStatus` heredado de un borrador anterior se ignora en métricas y motor, y el formulario lo descarta al editar.
- Al aplicar la migración del stand en staging no existían solicitudes de ese tipo (sección 16).

**Pruebas.** `projectRequestStandEvaluation.test.js` cubre:

- espacio asignado, en proceso o sin asignar;
- normas disponibles o no y documentación del evento;
- preguntas opcionales sin responder;
- inicio inmediato;
- capital y presupuesto;
- residencial con y sin inmueble;
- sección legal no aplicable;
- históricos 3.0, bloque ausente y tipo retirado;
- reenvío de un borrador con inmueble guardado;
- cola administrativa;
- datos inválidos enviados a la API.

Además, `projectRequestApplicability.test.js` verifica la paridad frontend/backend y la aceptación por la API de lo que el formulario valida. `Frontend/tests/projectRequestApplicability.test.js` y la suite de navegador cubren el cambio de tipo, la limpieza condicional y la restauración de borradores.

## 18. Fase 2 — revisión de penalizaciones (fórmula 3.2)

### 18.1. Causas modificadas

| Causa | 3.1 | 3.2 | Motivo |
| --- | --- | --- | --- |
| `REFERENCE_FILES_MISSING` (`referenceFilesMissing`) | −5 sin archivos | Retirada | Material opcional: su ausencia no indica falta de preparación ni incoherencia. |
| `REFERENCE_LINK_MISSING` (`referenceLinkMissing`) | −2 sin enlace válido | Retirada | Igual que los archivos. |
| `BLUEPRINTS_UNAVAILABLE` | −2 | Sin cambios | Propuesta en 18.4, pendiente de aprobación. |
| `PROJECT_SIZE_UNDEFINED` | −15 | Sin cambios | Propuesta en 18.5, pendiente de aprobación. |

Las demás causas, pesos, severidades, umbrales y la coherencia financiera no cambian. Los archivos y el enlace siguen siendo opcionales y conservan su validación, almacenamiento y presentación. Ya estaban fuera de la información completada.

Las evidencias retiradas se conservan en `RETIRED_EVIDENCE_RULES` de `projectRequestCompatibility.js`. El motor ya no las detecta, pero se usan para reconstruir los hallazgos y observaciones de evaluaciones 3.0/3.1 guardadas. El envío deja de consultar el uso de archivos, que solo alimentaba la regla retirada. Los límites de carga siguen en `projectRequestFileService`.

### 18.2. Resultados antes y después

| Escenario (perfil del caso A, sección 11) | 3.0/3.1 | 3.2 |
| --- | --- | --- |
| Con archivos y enlace | 100 · Excelente | 100 · Excelente |
| Sin archivos | 95 | 100 |
| Sin enlace | 98 | 100 |
| Sin archivos ni enlace | 93 | 100 |
| Sin inmueble, sin referencias | 93 | 100 |
| Stand publicitario, sin referencias | 93 | 100 |
| Sin planos, sin referencias | 91 | 98 |
| Tamaño sin definir, sin referencias | 78 · Buena | 85 · Excelente |
| Caso I (opcionales sin responder) | 78 · Buena | 85 · Excelente |
| Lujo con USD 10.000–50.000, sin referencias | 73 · Buena | 80 · Excelente |
| Capital indefinido e inicio inmediato, sin referencias | 73 · Buena | 80 · Excelente |

La subida máxima es de 7 puntos y solo afecta a solicitudes sin referencias. Algunas solicitudes cruzan el umbral de 80 y pasan de «Buena» a «Excelente» únicamente por no restar referencias. La información completada y la coherencia financiera no cambian.

### 18.3. Versionado e históricos

Las evaluaciones nuevas se guardan como `3.2`. Las 1.x/2.x conservan su comportamiento. Las 3.0, 3.1 y 3.2 reconstruyen hallazgos, incluidos los motivos retirados, sin recalcular puntuación ni nivel. Un reenvío tras correcciones se evalúa con 3.2.

### 18.4. Propuesta: planos del inmueble (implementada en 3.3, sección 19)

**Estado actual.** `BLUEPRINTS_UNAVAILABLE` resta 2 cuando el inmueble aplica y está disponible y los planos están en «No» o sin responder. No aplica sin inmueble ni en stands.

**Cuándo condicionan la preparación.** Los planos condicionan la preparación sobre todo cuando se interviene un inmueble existente con un inicio cercano: el levantamiento del estado actual consume tiempo antes del diseño. En obra nueva, o con inicio a más de 3 meses, su ausencia solo amplía el alcance del servicio, porque ARCA Studio puede levantarlos o elaborarlos. El formulario no distingue entre obra nueva y remodelación ni pregunta si el cliente desea ese servicio.

**Problemas de la regla actual.**

- Trata igual «No» (respuesta válida) y «sin responder»; esta última ya cuenta como incompleta en información completada.
- Presenta como déficit del cliente una necesidad que ARCA Studio puede cubrir.

**Alternativas, sin nuevas opciones ni pesos.**

1. **Recomendada:** retirar la deducción en una versión futura. «No» pasaría a un hallazgo informativo para administración, sin puntos, del tipo «Requiere levantamiento o elaboración de planos». Esto requiere aprobar ese tipo de hallazgo, que el modelo actual no tiene.
2. Conservar −2 solo con «No» explícito e inicio «De inmediato» o «1–3 meses», como cruce temporal. Sería una condición nueva sobre un peso existente.
3. A futuro, con aprobación: preguntar el tipo de intervención o si se desea el servicio de planos, y aplicar la regla solo a remodelaciones.

### 18.5. Propuesta: tamaño del proyecto (implementada con ajustes en 3.3, sección 19)

**Aplicabilidad verificada.** `PROJECT_SIZE_UNDEFINED` (−15) aplica igual a todos los tipos, incluido Stand publicitario, tanto con «No lo sé aún» como sin respuesta. Hay pruebas en `projectRequestScoringV32.test.js`.

**Situaciones en que el tamaño desconocido es información pendiente legítima.** En estos casos el tamaño no depende todavía del cliente:

- Stand con espacio «La asignación está en proceso» o «Aún no está asignado»: las medidas las fija el evento.
- Stand sin medidas o plano del espacio.
- Inmueble «En proceso de adquirirlo» o «No todavía», cuando la superficie depende del inmueble que se elija.

**Límite.** Los rangos de tamaño son superficies en m² pensadas para obras. No deben usarse para inferir equivalencias económicas entre stands y obras residenciales. Cualquier cruce de inversión con tamaño para stands requiere rangos propios aprobados.

**Alternativa propuesta.** No restar el tamaño desconocido en las situaciones anteriores, que seguirían visibles como respuesta «No lo sé aún». Conservar −15 cuando el tamaño es conocible: inmueble disponible o espacio del stand asignado. La pregunta seguiría contando en información completada. Requiere aprobación y una nueva versión.

### 18.6. Pruebas

`Backend/tests/projectRequestScoringV32.test.js` cubre:

- con y sin referencias, y que las evidencias retiradas no se detecten;
- sin inmueble y stand sin inmueble;
- stand con completitud pendiente;
- tamaño sin definir por tipo y sin planos;
- varias evidencias de una misma causa;
- históricos 3.0/3.1 con motivos retirados;
- coherencia financiera e información completada sin regresiones;
- envío sin consultar adjuntos.

`projectRequestScoring.test.js` se actualizó para la versión 3.2 y para la ausencia de deducción por referencias.

## 19. Fase 3 — planos y tamaño del proyecto (fórmula 3.3)

**Principio.** El formulario registra una solicitud preliminar, no un proyecto técnico definitivo. Administración y arquitectura aclaran la información pendiente después del envío. La puntuación no mide la seriedad del cliente, no aprueba ni rechaza y no bloquea el envío.

### 19.1. Catálogo actualizado

| Causa | 3.2 | 3.3 |
| --- | --- | --- |
| `BLUEPRINTS_UNAVAILABLE` (`blueprintsUnavailable`) | −2 con inmueble disponible y planos «No» o sin responder | **Retirada.** Se conserva en `RETIRED_EVIDENCE_RULES` para leer evaluaciones 3.0–3.2. Su función pasa a observaciones sin puntos (19.2). |
| `PROJECT_SIZE_UNDEFINED` (`projectSizeUndefined`) | −15 con tamaño «No lo sé aún» o sin responder, en todos los tipos | −15 solo si el tamaño es **estimable** (`canEstimateProjectSize`); en otro caso, 0. Mismo identificador, una sola regla y una sola deducción. |
| `REFERENCE_FILES_MISSING`, `REFERENCE_LINK_MISSING` | Retiradas en 3.2 | Siguen retiradas. |
| Inversión sin definir, desajuste inversión–alcance, capital frente al inicio, modalidad sin definir, documentación legal, inmueble frente al inicio | Sin cambios | Sin cambios. |

**Tamaño estimable.**

| Tipo | Condición para restar −15 con tamaño desconocido |
| --- | --- |
| Residencial, Comercial, Corporativo y el tipo histórico «Stands y exhibiciones» | Inmueble disponible («Sí, disponible»). En adquisición o «No todavía»: 0. |
| Stand publicitario | Espacio asignado **y** medidas o plano del espacio disponibles. Sin medidas, sin respuesta sobre medidas, asignación en proceso, sin asignar o sin bloque guardado: 0. |

Decisiones documentadas:

- **Tipo histórico.** `stands_exhibitions` sigue la regla del inmueble porque su contrato conserva la pregunta del terreno. No se reclasifica como Stand publicitario.
- **Tamaño sin responder.** Un tamaño sin responder se trata igual que «No lo sé aún» para la compatibilidad, como en versiones anteriores. En información completada, «No lo sé aún» cuenta como respondida y la ausencia como incompleta, sin cambios.
- **Mayor tamaño.** Un tamaño mayor nunca suma puntos ni se interpreta como falta de preparación.

### 19.2. Observaciones para la revisión (sin puntos)

El modelo de hallazgos de compatibilidad no admite hallazgos sin deducción sin efectos secundarios: cada hallazgo se persiste en `compatibility_reason_codes` y sus tres primeras explicaciones se muestran al cliente. Por eso se creó una representación explícita en `Backend/src/domain/projectRequestReviewObservations.js`.

| Código | Cuándo aparece | Texto |
| --- | --- | --- |
| `propertyBlueprintsUnavailable` | Inmueble aplicable y disponible, planos «No» | «El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos». |
| `propertyBlueprintsUnconfirmed` | Inmueble aplicable y disponible, planos sin responder | «No se ha confirmado la disponibilidad de planos del inmueble. Se recomienda aclararlo durante la revisión inicial». |

Características de las observaciones:

- No restan puntos ni modifican la coherencia financiera.
- No alteran la información completada: la pregunta de planos sigue su regla de completitud.
- No son riesgos financieros y no bloquean el envío.
- No aparecen sin inmueble ni en stands.
- Se calculan al vuelo, no se persisten y se exponen solo en la cola técnica (`WorkflowRequest.reviewObservations: [{code, explanation}]`).
- El drawer administrativo las muestra en «Observaciones para la revisión», solo cuando hay alguna. El cliente no las recibe.
- Al derivarse de las respuestas, también aparecen en solicitudes evaluadas con versiones anteriores, sin modificar su compatibilidad guardada.

### 19.3. Escenarios antes y después (motor real)

Perfil: residencial pequeño, coherente, inversión USD 10.000–50.000, capital disponible, inicio a más de 6 meses. En los stands, espacio asignado con medidas salvo que se indique otra cosa.

| Escenario | 3.2 | 3.3 |
| --- | --- | --- |
| Inmueble disponible, planos «No» | 98 | 100 + observación |
| Inmueble disponible, planos sin responder | 98 | 100 + observación |
| Residencial con inmueble disponible, tamaño desconocido | 85 | 85 |
| Ídem, sin planos | 83 | 85 + observación |
| Residencial en adquisición, tamaño desconocido | 85 | 100 |
| Residencial sin inmueble, tamaño desconocido | 85 | 100 |
| Stand con espacio asignado y medidas, tamaño desconocido | 85 | 85 |
| Stand con espacio asignado sin medidas, tamaño desconocido | 85 | 100 |
| Stand con asignación en proceso o sin asignar, tamaño desconocido | 85 | 100 |
| Sin inmueble, tamaño desconocido, capital indefinido e inicio inmediato | 45 · Media | 60 · Buena |

### 19.4. Integridad histórica

- Las evaluaciones nuevas se guardan como `3.3`.
- Las 3.0, 3.1 y 3.2 conservan puntuación, nivel, evidencias, observaciones y versión.
- `publicCompatibility` reconstruye sus hallazgos, incluidos los retirados, sin recalcular.
- No hay migraciones ni transformación de datos. Un reenvío tras correcciones se evalúa con 3.3.

### 19.5. Revisión de reglas económicas en stands (propuesta para una fase posterior)

En stands no se aplican reglas del inmueble: la sección legal y el inmueble frente al inicio son N/A desde 3.1. Sin embargo, `FINANCIAL_SCOPE_MISMATCH` y los agravantes de `FINANCIAL_DEFINITION_INSUFFICIENT` cruzan los rangos de tamaño en m² con rangos de inversión calibrados para obras. Por ejemplo, un stand «Grande (200-500 m²)» con menos de USD 10.000 resta 25. La coherencia financiera usa la misma matriz.

No se modifica en esta fase. Se propone revisarlo con rangos propios de stands aprobados por la dirección, sin equivalencias entre m² de stands y de construcción.

### 19.6. Pruebas

`Backend/tests/projectRequestScoringV33.test.js` cubre:

- planos en todos sus estados y aplicabilidades;
- observaciones sin puntos y lectura histórica de `blueprintsUnavailable`;
- tamaño por tipo y por estado del inmueble o del espacio, y la estimabilidad en todas las combinaciones;
- causas simultáneas;
- históricos 3.0–3.2;
- completitud de stands;
- coherencia financiera;
- cola administrativa y envío con versión 3.3.

En el frontend, `adminRequestDetails.test.js` y `tests/browser/projectRequestWorkflow.test.js` verifican la presentación y la ausencia de la sección cuando no aplica. Las validaciones, el cambio de tipo y la limpieza condicional siguen cubiertos por las suites de la fase 1.
