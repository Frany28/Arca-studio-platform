# Análisis del sistema de evaluación de solicitudes — Versión 3.3

## 1. Portada técnica

| | |
| --- | --- |
| **Proyecto** | ARCA Studio Platform — Sistema web |
| **Objeto** | Auditoría funcional, técnica y de negocio del algoritmo de evaluación de solicitudes preliminares |
| **Versión del algoritmo analizada** | 3.3 (versión vigente para solicitudes nuevas) |
| **Fecha** | 8 de octubre de 2026 |
| **Escenarios ejecutados** | 30, más 2 de verificación complementaria |
| **Naturaleza** | Documento base para un informe formal de aprobación. No modifica reglas vigentes. |

---

## 2. Resumen ejecutivo

**Qué se evaluó.** Se ejecutaron 30 solicitudes simuladas con el motor de evaluación vigente, versión 3.3:

- 8 residenciales;
- 6 comerciales;
- 6 corporativas;
- 10 stands publicitarios.

Todas las puntuaciones proceden del cálculo real. En los 30 casos se comprobó que la puntuación equivale a 100 menos la suma de una deducción máxima por causa.

**Resultado principal.** Las reglas se aplican tal como están definidas: **no se detectaron errores funcionales**. La evaluación es explicable porque cada punto descontado se atribuye a una causa y a las respuestas que la originan. Las reglas de stands, inmueble, planos y tamaño se aplican correctamente según el tipo de proyecto.

**Hallazgos que requieren decisión de la dirección.**

1. **La clasificación «Excelente» es amplia.** 22 de los 30 escenarios quedan en «Excelente compatibilidad». Nueve de ellos tienen además una advertencia en la coherencia financiera:
   - dos con «Riesgo financiero elevado»;
   - cuatro con «Requiere revisión financiera»;
   - tres con «Información financiera insuficiente».

   Una sola observación de gravedad alta (−20) deja la solicitud exactamente en 80 puntos, el límite inferior de «Excelente».
2. **Los cruces de inversión y tamaño no distinguen el tipo de proyecto.** En los stands publicitarios se usan los mismos rangos de superficie (m²) e inversión pensados para obras de arquitectura. Un stand «Grande» con menos de USD 10.000 pierde 25 puntos con la misma lógica que una vivienda.
3. **La información completada mide preguntas respondidas, no información definida.** Una solicitud con 24 puntos de compatibilidad puede mostrar 100 % de información completada, porque «No lo sé aún», «Por definir» e «Indefinido» son respuestas válidas.
4. **El identificador histórico «Stands y exhibiciones» se evalúa como un proyecto de arquitectura, no como Stand publicitario.** La dirección indica que ambos nombres corresponden al mismo servicio. Con respuestas equivalentes, el identificador antiguo obtiene 80 puntos y el vigente 100.
5. **El cliente ve el puntaje como un porcentaje** («80%») bajo el título «Compatibilidad con nuestros servicios». Sin embargo, el valor es una escala de 100 puntos con deducciones y mide la preparación y coherencia de una solicitud preliminar.

**Recomendación general.** Antes de la aprobación formal conviene decidir tres cuestiones:

- la regla de clasificación, para la que se presentan dos alternativas medidas sobre los 30 escenarios;
- el tratamiento económico de los stands;
- el nombre y formato visibles de la métrica.

Ninguna puntuación de este análisis demuestra la viabilidad económica real de un proyecto. Tampoco aprueba ni rechaza solicitudes.

---

## 3. Objetivo y alcance del análisis

**Objetivo.** Comprobar con evidencia reproducible si los tres indicadores producen resultados coherentes, justos y explicables para una solicitud preliminar:

- compatibilidad, que mide preparación y coherencia;
- información completada;
- coherencia financiera orientativa.

**Principios de referencia**, verificados en el código:

| Principio | Verificación |
| --- | --- |
| El cliente presenta una solicitud preliminar; no se le exige un proyecto arquitectónico completo. | Planos, referencias y tamaño desconocido no restan salvo cuando el tamaño es estimable. Tamaño, decisor, calidad, experiencia y planos son opcionales. |
| Administración y arquitectura revisan después la información. | La cola técnica expone métricas y observaciones para esa revisión. El envío no crea un proyecto. |
| La puntuación no mide la seriedad del cliente ni bloquea el envío. | El envío no consulta la puntuación. La evaluación se calcula después de validar y no condiciona el estado. |
| No se confunde falta de información con incapacidad económica. | La coherencia financiera no tiene porcentaje. «Información financiera insuficiente» es un estado distinto de «Riesgo financiero elevado». |
| Ninguna puntuación aprueba o rechaza. | No existe ninguna regla que cambie el estado de la solicitud según la puntuación. |

**Fuera del alcance:**

- modificar reglas, pesos, umbrales, validaciones, preguntas o datos;
- escribir en bases de datos;
- consultar datos reales de clientes;
- estimar costos reales de construcción o montaje.

---

## 4. Metodología y fuentes de verificación

1. **Lectura del código fuente vigente**, no solo de la documentación:
   - dominio de solicitud y aplicabilidad;
   - motor de compatibilidad;
   - completitud;
   - coherencia financiera y su matriz;
   - observaciones para la revisión;
   - esquemas de validación;
   - servicios de envío y cola técnica;
   - formulario y presentación de cliente y administración.
2. **Verificación de contratos.** Las opciones del formulario coinciden con el catálogo del backend; pruebas automáticas existentes lo verifican.
3. **Simulación con el motor real.** Durante la auditoría se evaluaron los escenarios directamente con las funciones productivas, sin duplicar reglas, usando registros con la misma forma que el registro guardado (anexo, sección 18). No se incorporó código de simulación al sistema.
4. **Verificaciones realizadas sobre los resultados:**
   - que hay 30 escenarios y su distribución;
   - que la versión es 3.3;
   - que cada puntuación es igual a 100 menos sus deducciones;
   - que no aparecen causas retiradas;
   - el cálculo de completitud;
   - la reproducibilidad;
   - las reglas condicionales de stands;
   - la cobertura de los cuatro estados financieros y de las siete causas activas.
5. **Sin escrituras en bases remotas.** No se ejecutaron las integraciones con PostgreSQL. La existencia de registros históricos se toma del registro documentado de la última consulta autorizada; no se volvió a consultar.

**Estado del repositorio al iniciar.** Sin cambios locales. La versión del algoritmo en el código es `COMPATIBILITY_SCORING_VERSION = "3.3"`.

---

## 5. Arquitectura actual del sistema de evaluación

```text
Formulario (cliente)
  └─ validación local ─► API: esquema Zod (crear/editar borrador)
                           └─ repositorio PostgreSQL (respuestas)
Envío de la solicitud
  └─ servicio ─► motor de compatibilidad 3.3 (función pura)
                  └─ guarda: puntuación, nivel, motivos (evidencias) y versión
Lectura (cliente y cola técnica)
  ├─ compatibilidad guardada → hallazgos reconstruidos (sin recalcular)
  ├─ información completada   → calculada al vuelo
  ├─ coherencia financiera    → calculada al vuelo (sin porcentaje)
  └─ observaciones para la revisión → al vuelo, solo en la cola técnica (administración/arquitectura)
```

| Indicador | Cálculo | Persistencia | Quién lo ve |
| --- | --- | --- | --- |
| Compatibilidad | 100 − Σ (deducción máxima de cada causa), limitada a 0–100 | Sí, con versión. Nunca se recalcula. | Cliente (puntaje, nivel y hasta 3 observaciones) y administración (puntaje y nivel) |
| Información completada | preguntas aplicables respondidas ÷ preguntas aplicables × 100 | No | Administración (la API del cliente también la devuelve, pero su vista no la muestra) |
| Coherencia financiera | Estado según una matriz relativa: sin incoherencias, revisión, riesgo elevado o información insuficiente | No | Administración (la API del cliente también la devuelve, pero su vista no la muestra) |
| Observaciones para la revisión | Avisos sin puntos (actualmente, planos del inmueble) | No | Administración y arquitectura |

**Aplicabilidad por tipo.**

| Tipo | Pregunta del inmueble y sección legal | Requisitos del stand | Tamaño desconocido resta −15 si… |
| --- | --- | --- | --- |
| Residencial, Comercial, Corporativo | Aplican; la sección legal solo con «Sí, disponible» | N/A | Inmueble «Sí, disponible» |
| Stand publicitario | N/A | Aplican (documentación solo con «Sí, tengo los requisitos») | Espacio asignado **y** medidas o plano disponibles |
| «Stands y exhibiciones» (identificador histórico) | Aplican, como en arquitectura | N/A | Inmueble «Sí, disponible» |

---

## 6. Inventario de preguntas y aplicabilidad

Leyenda: **C** = compatibilidad, **IC** = información completada, **CF** = coherencia financiera, **OR** = observación para la revisión.

| # | Pregunta | Control | Opciones | Obligatoria | Aplica cuando | C | IC | CF | OR |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Nombre del proyecto | Texto | 3–150 caracteres | Sí | Siempre | — | Sí | — | — |
| 2 | Tipo de proyecto | Selector | Residencial; Comercial; Corporativo; Stand publicitario | Sí | Siempre | Controla aplicabilidad | Sí | — | — |
| 3 | Ubicación del proyecto | Texto con sugerencias | Dirección 5–255 caracteres | Sí | Siempre | — | Sí | — | — |
| 4 | Descripción del proyecto | Texto multilínea | 30–100 caracteres | Sí | Siempre | — | Sí | — | — |
| 5 | Tamaño aproximado | Selector | Pequeño (< 80 m²); Mediano (80-200 m²); Grande (200-500 m²); Muy grande (> 500 m²); No lo sé aún | No | Siempre | −15 si es desconocido y estimable; se cruza con la inversión | Sí («No lo sé aún» cuenta) | Sí | — |
| 6 | ¿Cómo desea desarrollar el proyecto? | Selector | Por fases; En su totalidad; Por definir | Sí | Siempre (también en stands) | −10 con «Por definir» | Sí | Contexto («Por fases») | — |
| 7 | ¿Tiene terreno o inmueble disponible? | Botones de opción | Sí, disponible; En proceso de adquirirlo; No todavía | Sí, salvo en stand | Tipos de arquitectura | Se cruza con el inicio | Sí | — | — |
| 8 | Situación legal del inmueble | Selector | Sí, tengo la documentación disponible; La documentación está en trámite; No dispongo de documentación | Sí, si aplica | Inmueble disponible | −3 / −6 | Sí | — | — |
| 9 | Documentación disponible (inmueble) | Selección múltiple | Documento de propiedad; Contrato de compra; Contrato de arrendamiento; Otro documento | Sí, si aplica | Documentación disponible | — | Sí | — | — |
| 10 | ¿El inmueble tiene más de un propietario? | Selector | Sí; No | Sí, si aplica | Inmueble disponible | — | Sí | — | — |
| 11 | ¿Dispone de planos del lugar? | Casilla Sí/No/sin responder | Sí; No; sin responder | No | Inmueble disponible | — (retirada en 3.3) | Sí | — | «No» o sin responder |
| 12 | ¿El evento cuenta con normas o requisitos para el montaje? | Selector | Sí, tengo los requisitos; Estoy gestionando los requisitos; Aún no tengo los requisitos | No | Stand | — | Sí | — | — |
| 13 | Documentación disponible (evento) | Selección múltiple | Manual del expositor; Reglamento del evento; Especificaciones técnicas del stand; Otro | No | Stand con normas disponibles | — | Sí | — | — |
| 14 | ¿Ya tienes asignado el espacio dentro del evento? | Selector | Sí, ya está asignado; La asignación está en proceso; Aún no está asignado | Sí (stand) | Stand | Condiciona el tamaño estimable | Sí | — | — |
| 15 | ¿Tienes las medidas o plano del espacio asignado? | Casilla Sí/No/sin responder | Sí; No; sin responder | No | Stand | Condiciona el tamaño estimable | Sí | — | — |
| 16 | Rango de inversión estimado | Selector | No lo tengo definido aún; < USD 10.000; USD 10.000-50.000; USD 50.000-150.000; > USD 150.000 | Sí | Siempre | −15/−20 si es indefinida; cruces con tamaño y calidad | Sí | Sí | — |
| 17 | Disponibilidad del capital | Selector | Disponible ahora; En los próximos 3 meses; Busca financiamiento; Indefinido | Sí | Siempre | Se cruza con el inicio | Sí | Sí | — |
| 18 | ¿Cuándo espera iniciar el proyecto? | Botones de opción | De inmediato; 1-3 meses; 3-6 meses; Más de 6 meses | Sí | Siempre | Se cruza con capital, inmueble e inversión | Sí | Sí | — |
| 19 | ¿Quién toma la decisión final? | Selector | Yo solo/a; Con mi pareja/socio; Familia extendida; Empresa/junta | No | Siempre | — | Sí | — | — |
| 20 | Expectativa de estilo / nivel de calidad | Selector | Funcional y económico; Calidad estándar; Premium; Exclusivo/lujo | No | Siempre | Se cruza con la inversión | Sí | Sí | — |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Botones de opción | Sí, buena experiencia; Sí, mala experiencia; No, primera vez | No | Siempre | — | Sí | — | — |
| 22 | Imágenes o archivos | Carga de archivos | JPEG/JPG, PNG, PDF, MP4; hasta 10 archivos de 50 MB, 200 MB en total | No | Siempre | — (retirada en 3.2) | — | — | — |
| 23 | Link de referencia | Texto | URL http/https, hasta 500 caracteres | No | Siempre | — (retirada en 3.2) | — | — | — |

Las opciones de la tabla coinciden con el catálogo del frontend y con los valores del backend.

**Preguntas que pueden generar evaluaciones poco justificadas** (análisis en la sección 12):

- **Tamaño (#5) en stands.** Los rangos en m² están pensados para obras: casi todo stand cae en «Pequeño (< 80 m²)» y los rangos superiores activan cruces económicos de obra.
- **Modalidad (#6) en stands.** «Por fases» o «En su totalidad» tiene un significado limitado para un montaje efímero, pero «Por definir» resta 10.
- **Inversión (#16).** El formulario no indica si el presupuesto cubre diseño, ejecución o ambos. Es una limitación ya reconocida en la coherencia financiera.
- **Inmueble frente al inicio (#7 × #18).** En comercial y corporativo es habitual buscar un local; «No todavía» con inicio inmediato resta 20.

---

## 7. Catálogo completo de causas y deducciones

Cada causa descuenta una sola vez: la mayor deducción entre sus evidencias. Las causas distintas se acumulan. La gravedad es informativa y no añade deducciones.

| Causa | Categoría | Evidencias (condición → deducción · gravedad) | Deducción | Aplica a | Relación con otras causas | Justificación | Riesgo de penalización injustificada |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| `PROJECT_SIZE_UNDEFINED` | Alcance | `projectSizeUndefined`: tamaño «No lo sé aún» o sin responder **y** tamaño estimable → 15 · Media | 15 | Arquitectura con inmueble disponible; stand con espacio asignado y medidas | Independiente. El tamaño desconocido no activa los agravantes por tamaño de la inversión. | Con inmueble o espacio conocido, una estimación inicial es razonable. | Medio: −15 supera a «sin documentación legal» (−6) y equivale a una observación financiera de gravedad media. |
| `EXECUTION_MODE_UNDEFINED` | Alcance | `developmentModeUndefined`: «Por definir» → 10 · Media; `modeUndefinedImmediate`: «Por definir» e inicio inmediato → 10 · Media | 10 | Todos, incluido el stand | La segunda evidencia no añade deducción: solo traza el contexto. | Definir la modalidad ayuda a planificar. | Medio en stands: la pregunta tiene un significado limitado para un montaje. |
| `FINANCIAL_DEFINITION_INSUFFICIENT` | Financiera | `investmentRangeUndefined` 15 · Media; `veryLargeBudgetUndefined` 20 · Alta; `luxuryBudgetUndefined` 20 · Alta; `largeBudgetUndefined` 15 · Media; `premiumBudgetUndefined` 15 · Media; `budgetUndefinedImmediate` 10 · Media; `budgetUndefinedSoon` 5 · Baja | 15–20 | Todos | Excluyente con `FINANCIAL_SCOPE_MISMATCH` (exige inversión indefinida). Se acumula con `CAPITAL_TIMING_MISMATCH`. | Sin rango no se puede contrastar el alcance. | Medio: inversión y capital indefinidos con inicio inmediato suman −40 (R08) por dos aspectos de la misma indefinición económica. |
| `FINANCIAL_SCOPE_MISMATCH` | Financiera | `veryLargeBudgetUnder10k` 35 · Alta; `luxuryBudgetUnder10k` 30 · Alta; `largeBudgetUnder10k` 25 · Alta; `veryLargeBudget10k50k` 25 · Alta; `premiumBudgetUnder10k` 20 · Alta; `luxuryBudget10k50k` 20 · Alta; `mediumBudgetUnder10k` 10 · Media | 10–35 | Todos (sin distinción de tipo) | Tamaño y calidad se consolidan en una sola deducción (R07, S10). | Señala cruces que deben aclararse. No prueba insuficiencia. | **Alto en stands**: rangos de m² e inversión pensados para obras. |
| `CAPITAL_TIMING_MISMATCH` | Temporal | `capitalUndefinedImmediate` 20 · Alta; `financingImmediate` 15 · Media; `capitalWithin3MonthsImmediate` 10 · Media; `capitalUndefinedSoon` 10 · Media; `financingSoon` 8 · Baja | 8–20 | Todos | Independiente del inmueble; ambos pueden restar por el mismo inicio inmediato (R06: −25). | Un inicio cercano requiere fondos disponibles. | Bajo. Con plazo flexible no resta (C05). |
| `PROPERTY_TIMING_MISMATCH` | Temporal | `landUnavailableImmediate` 20 · Alta; `landAcquiringImmediate` 10 · Media; `landUnavailableSoon` 10 · Media | 10–20 | Arquitectura (N/A en stand) | Ver la relación con el capital. | Sin inmueble no se puede iniciar. | Medio en comercial y corporativo, donde buscar un local es habitual. |
| `LEGAL_DOCUMENTATION_PENDING` | Legal | `legalDocumentationUnavailable` 6 · Baja; `legalDocumentationInProcess` 3 · Baja (también con «disponible» sin tipos seleccionados, tratamiento defensivo) | 3–6 | Arquitectura con inmueble disponible | Independiente. | La documentación facilita el inicio. | Bajo. |

**Causas retiradas.** Se conservan solo para leer evaluaciones guardadas; los escenarios confirman que no vuelven a generarse.

| Causa | Evidencia | Peso histórico | Retirada en | Sustitución |
| --- | --- | ---: | --- | --- |
| `REFERENCE_FILES_MISSING` | `referenceFilesMissing` | 5 | 3.2 | Ninguna: material opcional |
| `REFERENCE_LINK_MISSING` | `referenceLinkMissing` | 2 | 3.2 | Ninguna: material opcional |
| `BLUEPRINTS_UNAVAILABLE` | `blueprintsUnavailable` | 2 | 3.3 | Observación para la revisión, sin puntos |

**Coherencia financiera (sin puntos).**

- **Matriz de tamaño × inversión.** Las celdas observadas son mediano, grande o muy grande con menos de USD 10.000, y muy grande con USD 10.000-50.000.
- **Matriz de calidad × inversión.** Las celdas observadas son Premium con menos de USD 10.000, y lujo con menos de USD 10.000 o con USD 10.000-50.000.
- **Matriz de capital × inicio.** Solo «Indefinido» con inicio inmediato produce «Riesgo financiero elevado».
- **Información insuficiente.** Se produce cuando no hay rango de inversión, o cuando faltan a la vez el tamaño comparable y la calidad.

Estas celdas reutilizan las mismas evidencias de compatibilidad sin volver a descontarlas.

---

## 8. Metodología de simulación

- **Fixtures.** Cada escenario es un registro completo con la forma que el servicio de envío entrega al motor. Las respuestas no aplicables llegan vacías, como exige el contrato. Se incluyen archivos y enlace de referencia, que no puntúan desde 3.2.
- **Perfiles base.**
  - Arquitectura preparada: inmueble disponible con documento de propiedad, planos, tamaño pequeño, USD 10.000-50.000, capital disponible, inicio a más de 6 meses y calidad estándar.
  - Stand preparado: espacio asignado con medidas, normas disponibles con el manual del expositor, mismas respuestas generales e inmueble N/A.

  Cada escenario cambia solo lo indicado en su resumen.
- **Distribución.** Se mantiene la recomendada: 8 residenciales, 6 comerciales, 6 corporativos y 10 stands. Con ella se cubren:
  - las siete causas activas;
  - los cuatro estados financieros;
  - las cinco combinaciones de espacio y medidas del stand.

  No fue necesario cambiarla.
- **Cobertura.** Hay escenarios bien definidos, con información pendiente, con contradicciones financieras, con distintas condiciones del inmueble, específicos de stands y con combinaciones de varias causas.
- **Escenarios no representativos de la población real.** El conjunto se diseñó para cubrir reglas, no para reproducir la frecuencia real de solicitudes. La distribución por clasificación sirve para analizar el comportamiento de los umbrales, no para predecir resultados reales.
- **Verificación complementaria.** Dos casos adicionales, fuera de los 30, comparan el identificador histórico con Stand publicitario con respuestas equivalentes.

---

## 9. Matriz de los 30 escenarios

Resultados del motor 3.3. «—» indica ausencia de causas u observaciones.

| ID | Tipo | Compatibilidad | Clasificación | Información completada | Coherencia financiera | Causas y deducciones | Observaciones para la revisión |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| R01 | Residencial | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — | — |
| R02 | Residencial | 100 | Excelente compatibilidad | 100 % (13/13) | Sin incoherencias financieras detectadas | — | — |
| R03 | Residencial | 75 | Buena compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | PROJECT_SIZE_UNDEFINED −15; EXECUTION_MODE_UNDEFINED −10 | propertyBlueprintsUnavailable |
| R04 | Residencial | 97 | Excelente compatibilidad | 75 % (12/16) | Sin incoherencias financieras detectadas | LEGAL_DOCUMENTATION_PENDING −3 | propertyBlueprintsUnconfirmed |
| R05 | Residencial | 80 | Excelente compatibilidad | 100 % (13/13) | Sin incoherencias financieras detectadas | PROPERTY_TIMING_MISMATCH −20 | — |
| R06 | Residencial | 75 | Buena compatibilidad | 100 % (13/13) | Requiere revisión financiera | CAPITAL_TIMING_MISMATCH −15; PROPERTY_TIMING_MISMATCH −10 | — |
| R07 | Residencial | 75 | Buena compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −25 | — |
| R08 | Residencial | 60 | Buena compatibilidad | 100 % (17/17) | Riesgo financiero elevado | FINANCIAL_DEFINITION_INSUFFICIENT −20; CAPITAL_TIMING_MISMATCH −20 | — |
| C01 | Comercial | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — | — |
| C02 | Comercial | 65 | Buena compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −35 | — |
| C03 | Comercial | 80 | Excelente compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −20 | — |
| C04 | Comercial | 80 | Excelente compatibilidad | 100 % (17/17) | Riesgo financiero elevado | CAPITAL_TIMING_MISMATCH −20 | — |
| C05 | Comercial | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — | — |
| C06 | Comercial | 84 | Excelente compatibilidad | 100 % (16/16) | Requiere revisión financiera | CAPITAL_TIMING_MISMATCH −10; LEGAL_DOCUMENTATION_PENDING −6 | propertyBlueprintsUnavailable |
| K01 | Corporativo | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — | — |
| K02 | Corporativo | 85 | Excelente compatibilidad | 100 % (17/17) | Información financiera insuficiente | FINANCIAL_DEFINITION_INSUFFICIENT −15 | — |
| K03 | Corporativo | 80 | Excelente compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −20 | — |
| K04 | Corporativo | 80 | Excelente compatibilidad | 100 % (13/13) | Requiere revisión financiera | CAPITAL_TIMING_MISMATCH −10; PROPERTY_TIMING_MISMATCH −10 | — |
| K05 | Corporativo | 24 | Baja compatibilidad | 100 % (16/16) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −30; PROJECT_SIZE_UNDEFINED −15; CAPITAL_TIMING_MISMATCH −15; EXECUTION_MODE_UNDEFINED −10; LEGAL_DOCUMENTATION_PENDING −6 | — |
| K06 | Corporativo | 85 | Excelente compatibilidad | 76 % (13/17) | Información financiera insuficiente | PROJECT_SIZE_UNDEFINED −15 | — |
| S01 | Stand publicitario | 100 | Excelente compatibilidad | 100 % (16/16) | Sin incoherencias financieras detectadas | — | — |
| S02 | Stand publicitario | 85 | Excelente compatibilidad | 100 % (16/16) | Sin incoherencias financieras detectadas | PROJECT_SIZE_UNDEFINED −15 | — |
| S03 | Stand publicitario | 100 | Excelente compatibilidad | 100 % (16/16) | Sin incoherencias financieras detectadas | — | — |
| S04 | Stand publicitario | 100 | Excelente compatibilidad | 93 % (14/15) | Sin incoherencias financieras detectadas | — | — |
| S05 | Stand publicitario | 100 | Excelente compatibilidad | 100 % (15/15) | Sin incoherencias financieras detectadas | — | — |
| S06 | Stand publicitario | 100 | Excelente compatibilidad | 88 % (14/16) | Sin incoherencias financieras detectadas | — | — |
| S07 | Stand publicitario | 75 | Buena compatibilidad | 100 % (16/16) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −25 | — |
| S08 | Stand publicitario | 80 | Excelente compatibilidad | 100 % (16/16) | Riesgo financiero elevado | CAPITAL_TIMING_MISMATCH −20 | — |
| S09 | Stand publicitario | 85 | Excelente compatibilidad | 100 % (16/16) | Información financiera insuficiente | FINANCIAL_DEFINITION_INSUFFICIENT −15 | — |
| S10 | Stand publicitario | 40 | Compatibilidad media | 100 % (16/16) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −35; CAPITAL_TIMING_MISMATCH −15; EXECUTION_MODE_UNDEFINED −10 | — |

---

## 10. Desglose individual de cada escenario

Cada escenario muestra:

- respuestas relevantes, versión, puntuación y cálculo;
- información completada (con las preguntas pendientes) y estado financiero con sus hallazgos;
- observaciones para la revisión y reglas de aplicabilidad;
- cada causa con su categoría, gravedad, evidencias y deducción.

#### R01 — Residencial · Bien definida

- **Respuestas relevantes:** Inmueble disponible con documentación y planos; pequeño; USD 10.000–50.000; capital disponible; inicio > 6 meses.
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### R02 — Residencial · Condición del inmueble

- **Respuestas relevantes:** Sin inmueble («No todavía»); mediano; USD 50.000–150.000; capital disponible; inicio > 6 meses.
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (13/13); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sección legal y planos N/A (sin inmueble disponible).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### R03 — Residencial · Información pendiente

- **Respuestas relevantes:** Inmueble disponible; tamaño «No lo sé aún»; modalidad «Por definir»; planos «No»; sin archivos ni enlace.
- **Versión:** 3.3 · **Compatibilidad:** 75 (Buena compatibilidad) · **Cálculo:** 100 − (15 + 10) = 75
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** «El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.»
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| PROJECT_SIZE_UNDEFINED | SCOPE | MEDIUM | projectSizeUndefined | −15 |
| EXECUTION_MODE_UNDEFINED | SCOPE | MEDIUM | developmentModeUndefined | −10 |
| **Total** | | | | **−25** |

#### R04 — Residencial · Información pendiente

- **Respuestas relevantes:** Inmueble disponible; documentación legal en trámite; planos sin responder; decisor, calidad y experiencia sin responder.
- **Versión:** 3.3 · **Compatibilidad:** 97 (Excelente compatibilidad) · **Cálculo:** 100 − (3) = 97
- **Información completada:** 75 % (12/16); pendientes: hasPlans, decisionMaker, quality, experience.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** «No se ha confirmado la disponibilidad de planos del inmueble. Se recomienda aclararlo durante la revisión inicial.»
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| LEGAL_DOCUMENTATION_PENDING | LEGAL | LOW | legalDocumentationInProcess | −3 |
| **Total** | | | | **−3** |

#### R05 — Residencial · Condición del inmueble

- **Respuestas relevantes:** Sin inmueble («No todavía») e inicio «De inmediato»; capital disponible.
- **Versión:** 3.3 · **Compatibilidad:** 80 (Excelente compatibilidad) · **Cálculo:** 100 − (20) = 80
- **Información completada:** 100 % (13/13); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sección legal y planos N/A (sin inmueble disponible).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| PROPERTY_TIMING_MISMATCH | TEMPORAL | HIGH | landUnavailableImmediate | −20 |
| **Total** | | | | **−20** |

#### R06 — Residencial · Contradicción financiera

- **Respuestas relevantes:** Inmueble en adquisición; inicio «De inmediato»; busca financiamiento.
- **Versión:** 3.3 · **Compatibilidad:** 75 (Buena compatibilidad) · **Cálculo:** 100 − (15 + 10) = 75
- **Información completada:** 100 % (13/13); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: CAPITAL_TIMING_MISMATCH (REVIEW_REQUIRED: financingImmediate).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sección legal y planos N/A (sin inmueble disponible).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | MEDIUM | financingImmediate | −15 |
| PROPERTY_TIMING_MISMATCH | TEMPORAL | MEDIUM | landAcquiringImmediate | −10 |
| **Total** | | | | **−25** |

#### R07 — Residencial · Contradicción financiera

- **Respuestas relevantes:** Grande (200–500 m²) y Premium con menos de USD 10.000.
- **Versión:** 3.3 · **Compatibilidad:** 75 (Buena compatibilidad) · **Cálculo:** 100 − (25) = 75
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: FINANCIAL_SCOPE_MISMATCH (REVIEW_REQUIRED: largeBudgetUnder10k, premiumBudgetUnder10k); BUDGET_COVERAGE_UNSPECIFIED (INFORMATIVE: budgetCoverageUnspecified).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | FINANCIAL | HIGH | largeBudgetUnder10k, premiumBudgetUnder10k | −25 |
| **Total** | | | | **−25** |

#### R08 — Residencial · Combinación

- **Respuestas relevantes:** Inversión indefinida; muy grande; lujo; capital indefinido; inicio «De inmediato».
- **Versión:** 3.3 · **Compatibilidad:** 60 (Buena compatibilidad) · **Cálculo:** 100 − (20 + 20) = 60
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Riesgo financiero elevado. Hallazgos: CAPITAL_TIMING_MISMATCH (HIGH_RISK: capitalUndefinedImmediate); FINANCIAL_DEFINITION_INSUFFICIENT (INSUFFICIENT_DATA: investmentRangeUndefined).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_DEFINITION_INSUFFICIENT | FINANCIAL | HIGH | veryLargeBudgetUndefined, luxuryBudgetUndefined, investmentRangeUndefined, budgetUndefinedImmediate | −20 |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | HIGH | capitalUndefinedImmediate | −20 |
| **Total** | | | | **−40** |

#### C01 — Comercial · Bien definida

- **Respuestas relevantes:** Local arrendado (contrato de arrendamiento); mediano; USD 50.000–150.000; por fases; inicio 1–3 meses.
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### C02 — Comercial · Contradicción financiera

- **Respuestas relevantes:** Muy grande (> 500 m²) con menos de USD 10.000; por fases.
- **Versión:** 3.3 · **Compatibilidad:** 65 (Buena compatibilidad) · **Cálculo:** 100 − (35) = 65
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: FINANCIAL_SCOPE_MISMATCH (REVIEW_REQUIRED: veryLargeBudgetUnder10k); BUDGET_COVERAGE_UNSPECIFIED (INFORMATIVE: budgetMayCoverPhase).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | FINANCIAL | HIGH | veryLargeBudgetUnder10k | −35 |
| **Total** | | | | **−35** |

#### C03 — Comercial · Contradicción financiera

- **Respuestas relevantes:** Calidad «Exclusivo/lujo» con USD 10.000–50.000 (única observación).
- **Versión:** 3.3 · **Compatibilidad:** 80 (Excelente compatibilidad) · **Cálculo:** 100 − (20) = 80
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: FINANCIAL_SCOPE_MISMATCH (REVIEW_REQUIRED: luxuryBudget10k50k); BUDGET_COVERAGE_UNSPECIFIED (INFORMATIVE: budgetCoverageUnspecified).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | FINANCIAL | HIGH | luxuryBudget10k50k | −20 |
| **Total** | | | | **−20** |

#### C04 — Comercial · Contradicción financiera

- **Respuestas relevantes:** Capital «Indefinido» e inicio «De inmediato» (única observación).
- **Versión:** 3.3 · **Compatibilidad:** 80 (Excelente compatibilidad) · **Cálculo:** 100 − (20) = 80
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Riesgo financiero elevado. Hallazgos: CAPITAL_TIMING_MISMATCH (HIGH_RISK: capitalUndefinedImmediate).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | HIGH | capitalUndefinedImmediate | −20 |
| **Total** | | | | **−20** |

#### C05 — Comercial · Contradicción financiera

- **Respuestas relevantes:** Busca financiamiento con inicio flexible (3–6 meses).
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### C06 — Comercial · Condición del inmueble

- **Respuestas relevantes:** Sin documentación legal; planos «No»; capital en 3 meses e inicio «De inmediato».
- **Versión:** 3.3 · **Compatibilidad:** 84 (Excelente compatibilidad) · **Cálculo:** 100 − (10 + 6) = 84
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: CAPITAL_TIMING_MISMATCH (REVIEW_REQUIRED: capitalWithin3MonthsImmediate).
- **Observaciones para la revisión:** «El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.»
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | MEDIUM | capitalWithin3MonthsImmediate | −10 |
| LEGAL_DOCUMENTATION_PENDING | LEGAL | LOW | legalDocumentationUnavailable | −6 |
| **Total** | | | | **−16** |

#### K01 — Corporativo · Bien definida

- **Respuestas relevantes:** Grande; más de USD 150.000; Premium; decisión de empresa/junta; inicio 3–6 meses.
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### K02 — Corporativo · Información pendiente

- **Respuestas relevantes:** Inversión «No lo tengo definido aún»; grande; inicio > 6 meses.
- **Versión:** 3.3 · **Compatibilidad:** 85 (Excelente compatibilidad) · **Cálculo:** 100 − (15) = 85
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Información financiera insuficiente. Hallazgos: FINANCIAL_DEFINITION_INSUFFICIENT (INSUFFICIENT_DATA: investmentRangeUndefined).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_DEFINITION_INSUFFICIENT | FINANCIAL | MEDIUM | investmentRangeUndefined, largeBudgetUndefined | −15 |
| **Total** | | | | **−15** |

#### K03 — Corporativo · Contradicción financiera

- **Respuestas relevantes:** Premium con menos de USD 10.000; tamaño pequeño (única observación).
- **Versión:** 3.3 · **Compatibilidad:** 80 (Excelente compatibilidad) · **Cálculo:** 100 − (20) = 80
- **Información completada:** 100 % (17/17); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: FINANCIAL_SCOPE_MISMATCH (REVIEW_REQUIRED: premiumBudgetUnder10k); BUDGET_COVERAGE_UNSPECIFIED (INFORMATIVE: budgetCoverageUnspecified).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | FINANCIAL | HIGH | premiumBudgetUnder10k | −20 |
| **Total** | | | | **−20** |

#### K04 — Corporativo · Condición del inmueble

- **Respuestas relevantes:** Sin inmueble; tamaño «No lo sé aún»; capital indefinido; inicio 1–3 meses.
- **Versión:** 3.3 · **Compatibilidad:** 80 (Excelente compatibilidad) · **Cálculo:** 100 − (10 + 10) = 80
- **Información completada:** 100 % (13/13); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: CAPITAL_TIMING_MISMATCH (REVIEW_REQUIRED: capitalUndefinedSoon).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sección legal y planos N/A (sin inmueble disponible). Tamaño desconocido sin deducción: no es estimable con las respuestas dadas.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | MEDIUM | capitalUndefinedSoon | −10 |
| PROPERTY_TIMING_MISMATCH | TEMPORAL | MEDIUM | landUnavailableSoon | −10 |
| **Total** | | | | **−20** |

#### K05 — Corporativo · Combinación

- **Respuestas relevantes:** Inmueble disponible sin documentación; tamaño desconocido; modalidad por definir; lujo con menos de USD 10.000; financiamiento e inicio inmediato.
- **Versión:** 3.3 · **Compatibilidad:** 24 (Baja compatibilidad) · **Cálculo:** 100 − (30 + 15 + 15 + 10 + 6) = 24
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: FINANCIAL_SCOPE_MISMATCH (REVIEW_REQUIRED: luxuryBudgetUnder10k); CAPITAL_TIMING_MISMATCH (REVIEW_REQUIRED: financingImmediate); BUDGET_COVERAGE_UNSPECIFIED (INFORMATIVE: budgetCoverageUnspecified).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | FINANCIAL | HIGH | luxuryBudgetUnder10k | −30 |
| PROJECT_SIZE_UNDEFINED | SCOPE | MEDIUM | projectSizeUndefined | −15 |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | MEDIUM | financingImmediate | −15 |
| EXECUTION_MODE_UNDEFINED | SCOPE | MEDIUM | developmentModeUndefined, modeUndefinedImmediate | −10 |
| LEGAL_DOCUMENTATION_PENDING | LEGAL | LOW | legalDocumentationUnavailable | −6 |
| **Total** | | | | **−76** |

#### K06 — Corporativo · Información pendiente

- **Respuestas relevantes:** Inmueble disponible; tamaño, calidad, decisor y experiencia sin responder; sin referencias.
- **Versión:** 3.3 · **Compatibilidad:** 85 (Excelente compatibilidad) · **Cálculo:** 100 − (15) = 85
- **Información completada:** 76 % (13/17); pendientes: projectSize, decisionMaker, quality, experience.
- **Coherencia financiera:** Información financiera insuficiente. Hallazgos: FINANCIAL_SCOPE_UNDEFINED (INSUFFICIENT_DATA: financialScopeUndefined).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sin reglas N/A relevantes.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| PROJECT_SIZE_UNDEFINED | SCOPE | MEDIUM | projectSizeUndefined | −15 |
| **Total** | | | | **−15** |

#### S01 — Stand publicitario · Bien definida

- **Respuestas relevantes:** Espacio asignado con medidas; normas disponibles con manual del expositor; pequeño; USD 10.000–50.000.
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### S02 — Stand publicitario · Stand: espacio y tamaño

- **Respuestas relevantes:** Espacio asignado con medidas; tamaño «No lo sé aún».
- **Versión:** 3.3 · **Compatibilidad:** 85 (Excelente compatibilidad) · **Cálculo:** 100 − (15) = 85
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| PROJECT_SIZE_UNDEFINED | SCOPE | MEDIUM | projectSizeUndefined | −15 |
| **Total** | | | | **−15** |

#### S03 — Stand publicitario · Stand: espacio y tamaño

- **Respuestas relevantes:** Espacio asignado sin medidas; tamaño «No lo sé aún».
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario). Tamaño desconocido sin deducción: no es estimable con las respuestas dadas.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### S04 — Stand publicitario · Stand: espacio y tamaño

- **Respuestas relevantes:** Asignación en proceso; normas en trámite; medidas sin responder; tamaño «No lo sé aún».
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 93 % (14/15); pendientes: standRequirements.hasSpacePlans.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario). Tamaño desconocido sin deducción: no es estimable con las respuestas dadas.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### S05 — Stand publicitario · Stand: espacio y tamaño

- **Respuestas relevantes:** Espacio no asignado; normas no disponibles; sin medidas; inicio «De inmediato».
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (15/15); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### S06 — Stand publicitario · Información pendiente

- **Respuestas relevantes:** Normas disponibles sin documentación seleccionada; medidas del espacio sin responder.
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 88 % (14/16); pendientes: standRequirements.documentTypes, standRequirements.hasSpacePlans.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |

#### S07 — Stand publicitario · Contradicción financiera

- **Respuestas relevantes:** Grande (200–500 m²) con menos de USD 10.000.
- **Versión:** 3.3 · **Compatibilidad:** 75 (Buena compatibilidad) · **Cálculo:** 100 − (25) = 75
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: FINANCIAL_SCOPE_MISMATCH (REVIEW_REQUIRED: largeBudgetUnder10k); BUDGET_COVERAGE_UNSPECIFIED (INFORMATIVE: budgetCoverageUnspecified).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | FINANCIAL | HIGH | largeBudgetUnder10k | −25 |
| **Total** | | | | **−25** |

#### S08 — Stand publicitario · Contradicción financiera

- **Respuestas relevantes:** Capital «Indefinido» e inicio «De inmediato».
- **Versión:** 3.3 · **Compatibilidad:** 80 (Excelente compatibilidad) · **Cálculo:** 100 − (20) = 80
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Riesgo financiero elevado. Hallazgos: CAPITAL_TIMING_MISMATCH (HIGH_RISK: capitalUndefinedImmediate).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | HIGH | capitalUndefinedImmediate | −20 |
| **Total** | | | | **−20** |

#### S09 — Stand publicitario · Información pendiente

- **Respuestas relevantes:** Inversión indefinida; Premium; inicio 1–3 meses.
- **Versión:** 3.3 · **Compatibilidad:** 85 (Excelente compatibilidad) · **Cálculo:** 100 − (15) = 85
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Información financiera insuficiente. Hallazgos: FINANCIAL_DEFINITION_INSUFFICIENT (INSUFFICIENT_DATA: investmentRangeUndefined).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_DEFINITION_INSUFFICIENT | FINANCIAL | MEDIUM | investmentRangeUndefined, premiumBudgetUndefined, budgetUndefinedSoon | −15 |
| **Total** | | | | **−15** |

#### S10 — Stand publicitario · Combinación

- **Respuestas relevantes:** Muy grande y lujo con menos de USD 10.000; modalidad por definir; financiamiento e inicio inmediato.
- **Versión:** 3.3 · **Compatibilidad:** 40 (Compatibilidad media) · **Cálculo:** 100 − (35 + 15 + 10) = 40
- **Información completada:** 100 % (16/16); pendientes: ninguna.
- **Coherencia financiera:** Requiere revisión financiera. Hallazgos: FINANCIAL_SCOPE_MISMATCH (REVIEW_REQUIRED: veryLargeBudgetUnder10k, luxuryBudgetUnder10k); CAPITAL_TIMING_MISMATCH (REVIEW_REQUIRED: financingImmediate); BUDGET_COVERAGE_UNSPECIFIED (INFORMATIVE: budgetCoverageUnspecified).
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario).

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | FINANCIAL | HIGH | veryLargeBudgetUnder10k, luxuryBudgetUnder10k | −35 |
| CAPITAL_TIMING_MISMATCH | TEMPORAL | MEDIUM | financingImmediate | −15 |
| EXECUTION_MODE_UNDEFINED | SCOPE | MEDIUM | developmentModeUndefined, modeUndefinedImmediate | −10 |
| **Total** | | | | **−60** |

---

## 11. Resultados estadísticos y distribución por clasificación

| Clasificación | Escenarios | % | IDs |
| --- | ---: | ---: | --- |
| Excelente compatibilidad | 22 | 73 % | R01, R02, R04, R05, C01, C03, C04, C05, C06, K01, K02, K03, K04, K06, S01, S02, S03, S04, S05, S06, S08, S09 |
| Buena compatibilidad | 6 | 20 % | R03, R06, R07, R08, C02, S07 |
| Compatibilidad media | 1 | 3 % | S10 |
| Baja compatibilidad | 1 | 3 % | K05 |
| Solicitud poco definida | 0 | 0 % | — |

| Medida | Todos | Residencial | Comercial | Corporativo | Stand publicitario |
| --- | ---: | ---: | ---: | ---: | ---: |
| Escenarios | 30 | 8 | 6 | 6 | 10 |
| Media | 83,0 | 82,8 | 84,8 | 75,7 | 86,5 |
| Mediana | 84,5 | 77,5 | 82 | 82,5 | 92,5 |
| Mínimo | 24 | 60 | 65 | 24 | 40 |
| Máximo | 100 | 100 | 100 | 100 | 100 |

**Coherencia financiera.**

| Estado | Escenarios |
| --- | --- |
| Sin incoherencias financieras detectadas (14) | R01, R02, R03, R04, R05, C01, C05, K01, S01, S02, S03, S04, S05, S06 |
| Requiere revisión financiera (10) | R06, R07, C02, C03, C06, K03, K04, K05, S07, S10 |
| Riesgo financiero elevado (3) | R08, C04, S08 |
| Información financiera insuficiente (3) | K02, K06, S09 |

**Frecuencia de causas.**

| Causa | Escenarios (deducción) |
| --- | --- |
| `CAPITAL_TIMING_MISMATCH` (8) | R06 (−15), R08 (−20), C04 (−20), C06 (−10), K04 (−10), K05 (−15), S08 (−20), S10 (−15) |
| `FINANCIAL_SCOPE_MISMATCH` (7) | R07 (−25), C02 (−35), C03 (−20), K03 (−20), K05 (−30), S07 (−25), S10 (−35) |
| `PROJECT_SIZE_UNDEFINED` (4) | R03, K05, K06, S02 (−15 cada uno) |
| `EXECUTION_MODE_UNDEFINED` (3) | R03, K05, S10 (−10 cada uno) |
| `LEGAL_DOCUMENTATION_PENDING` (3) | R04 (−3), C06 (−6), K05 (−6) |
| `PROPERTY_TIMING_MISMATCH` (3) | R05 (−20), R06 (−10), K04 (−10) |
| `FINANCIAL_DEFINITION_INSUFFICIENT` (3) | R08 (−20), K02 (−15), S09 (−15) |

**Otros datos.**

- Información completada: 26 de 30 escenarios alcanzan el 100 %; el mínimo es 75 % (R04).
- Diez escenarios obtienen 100 de compatibilidad.
- Las observaciones para la revisión aparecen en R03 y C06 (sin planos) y en R04 (planos sin confirmar).

---

## 12. Análisis de incoherencias y riesgos

### 12.1. Errores funcionales (el código no cumple las reglas definidas)

**No se detectaron errores funcionales.** En los 30 escenarios se cumple lo siguiente:

- La puntuación coincide con 100 menos las deducciones únicas.
- Cada causa aparece una sola vez y las causas retiradas no se generan.
- La completitud coincide con su fórmula.
- Los stands no reciben deducciones de inmueble, legales ni de planos.
- El tamaño desconocido solo resta cuando es estimable: S02 resta; S03 y S04 no.

Observaciones técnicas menores, que no son errores con datos validados:

| ID | Observación | Impacto |
| --- | --- | --- |
| T1 | Ante un capital ausente, el motor de compatibilidad lo trata como «Indefinido» (por ejemplo, −20 con inicio inmediato), mientras que la coherencia financiera no lo evalúa. | Nulo con datos validados: la API exige el capital. Solo afectaría a registros incompletos. |
| T2 | El cliente ve el puntaje con el símbolo «%» («80%»), aunque es una escala de puntos con deducciones, no un porcentaje. | Presentación: puede interpretarse como «80 % de probabilidad» o «80 % compatible con nuestros servicios». |

### 12.2. Inconsistencias de negocio (el código cumple, pero el resultado puede no ser razonable)

| ID | Inconsistencia | Evidencia |
| --- | --- | --- |
| N1 | **«Excelente» con advertencias financieras.** Nueve de las 22 solicitudes «Excelentes» tienen la coherencia financiera en revisión, riesgo elevado o información insuficiente. Una sola deducción de gravedad alta (−20) deja exactamente 80 puntos. | C04 y S08: capital indefinido e inicio inmediato, 80 · Excelente · Riesgo financiero elevado. C03 y K03: 80 · Excelente · Requiere revisión. R05: 80 · Excelente sin inmueble e inicio inmediato. |
| N2 | **La información completada puede parecer engañosa.** Mide preguntas respondidas, no información definida. | K05: 24 de compatibilidad con 100 % de información completada. R03: tamaño, modalidad y planos pendientes con 100 %. |
| N3 | **Los cruces económicos no distinguen el tipo de proyecto.** Los rangos en m² e inversión son los mismos para stands y obras. | S07: stand grande con menos de USD 10.000, −25. S10: −35. En S01–S06, con stands pequeños, la matriz no discrimina. |
| N4 | **El identificador histórico se trata como arquitectura.** «Stands y exhibiciones» conserva la pregunta del inmueble y sus reglas temporales; no usa los requisitos del stand. | H01: 80 (−20 por inmueble frente al inicio). H02, equivalente con Stand publicitario: 100. |
| N5 | **La indefinición económica puede restar por dos causas.** La inversión indefinida y el capital indefinido son preguntas distintas, pero ambas expresan falta de definición económica. | R08: −20 −20 = 60 · Buena. |
| N6 | **Proporción de pesos.** No conocer el tamaño con inmueble disponible (−15) resta más que no disponer de documentación legal (−6) y más que buscar financiamiento con inicio en 1–3 meses (−8). | R03, K06, S02 (−15) frente a R04 (−3) y C06 (−6). |
| N7 | **Inmueble frente al inicio en comercial y corporativo.** Buscar un local y querer empezar pronto es habitual. ARCA Studio podría incluso acompañar esa búsqueda. | R05 (−20) y K04 (−10). |
| N8 | **Modalidad de desarrollo en stands.** «Por definir» resta 10, aunque «Por fases» o «En su totalidad» tiene un significado limitado para un montaje. | S10 (−10). |
| N9 | **Nombre de la métrica.** El cliente ve «Compatibilidad con nuestros servicios», pero la métrica mide la preparación y coherencia de la solicitud, no si ARCA Studio presta el servicio. El texto de apoyo visible sí lo explica. | Presentación de la solicitud recibida. |

### 12.3. Decisiones pendientes (requieren aprobación; no son errores)

1. La regla de clasificación (sección 14.1).
2. El tratamiento económico de stands (sección 14.2).
3. El tratamiento del identificador histórico (sección 14.3).
4. Cómo presentar la información completada (sección 14.4).
5. La proporción entre el tamaño desconocido y otras causas, y la posible acumulación de inversión y capital indefinidos (sección 14.5).
6. El nombre y formato visibles de la métrica (sección 14.6).

---

## 13. Evaluación específica de stands publicitarios

| Aspecto | Comportamiento comprobado | Valoración |
| --- | --- | --- |
| Inmueble y sección legal | N/A en todos los stands. Sin deducciones legales ni de inmueble frente al inicio, aunque el inicio sea inmediato (S05). | Correcto |
| Planos del inmueble | N/A; no hay observaciones para la revisión en stands. | Correcto |
| Tamaño desconocido | Resta solo con espacio asignado y medidas (S02). Sin medidas (S03), en proceso (S04) o sin asignar (H02) no resta. | Correcto según la regla 3.3 |
| Requisitos del evento | Cuentan en la información completada: S04 93 % y S06 88 % por respuestas pendientes. No puntúan. | Correcto |
| Capital frente al inicio | Se aplica igual que en arquitectura (S08: −20, riesgo elevado). | Razonable: no depende del tipo |
| Inversión indefinida | Se aplica igual (S09: −15). | Razonable |
| Tamaño × inversión | Se aplica con rangos de obra (S07: −25; S10: −35). | **Inconsistencia de negocio (N3)** |
| Calidad × inversión | Se aplica con los mismos rangos (S10: lujo con menos de USD 10.000). | Pendiente de validar con costos de stands |
| Opciones de tamaño | «Pequeño (< 80 m²)» agrupa la mayoría de los stands; los demás rangos son de obra. | **Limitación del formulario** |
| Modalidad de desarrollo | «Por definir» resta 10 (S10). | **Inconsistencia de negocio (N8)** |
| Identificador histórico | Se evalúa como arquitectura (H01). | **Inconsistencia potencial (N4)** |

**Sobre el identificador histórico.** El catálogo vigente solo ofrece «Stand publicitario». Técnicamente, «Stands y exhibiciones» se conserva como un identificador distinto:

- para leer y editar registros anteriores;
- en el tipo enumerado de PostgreSQL, sin conversión.

Al aplicar la migración del stand se registró que no existía ninguna solicitud con ese identificador; en esta auditoría no se volvió a consultar la base. Si la dirección confirma que ambos nombres corresponden al mismo servicio, el comportamiento distinto del identificador antiguo debe revisarse.

---

## 14. Comparación de posibles alternativas

Ninguna alternativa está implementada. Las alternativas de clasificación se calcularon sobre las puntuaciones reales obtenidas del motor. Las demás proyecciones son aritméticas sobre las deducciones mostradas y se indican como tales.

### 14.1. Clasificación

- **Comportamiento actual.** Umbrales 80, 60, 40 y 20. Una sola observación de gravedad alta de −20 deja «Excelente».
- **Problema.** 22 de 30 escenarios son «Excelentes», incluidos casos con riesgo financiero elevado o revisión financiera.
- **Alternativa A — umbrales más exigentes:** Excelente 90–100, Buena 75–89, Media 50–74, Baja 25–49, Poco definida 0–24.
- **Alternativa B — mismos umbrales con tope por gravedad:** si existe una causa de gravedad alta, el nivel no supera «Buena». No cambia ninguna puntuación.

| ID | Puntuación | Vigente | Alternativa A | Alternativa B |
| --- | ---: | --- | --- | --- |
| R05 | 80 | Excelente compatibilidad | Buena compatibilidad | Buena compatibilidad |
| R08 | 60 | Buena compatibilidad | Compatibilidad media | Buena compatibilidad |
| C02 | 65 | Buena compatibilidad | Compatibilidad media | Buena compatibilidad |
| C03 | 80 | Excelente compatibilidad | Buena compatibilidad | Buena compatibilidad |
| C04 | 80 | Excelente compatibilidad | Buena compatibilidad | Buena compatibilidad |
| C06 | 84 | Excelente compatibilidad | Buena compatibilidad | Excelente compatibilidad |
| K02 | 85 | Excelente compatibilidad | Buena compatibilidad | Excelente compatibilidad |
| K03 | 80 | Excelente compatibilidad | Buena compatibilidad | Buena compatibilidad |
| K04 | 80 | Excelente compatibilidad | Buena compatibilidad | Excelente compatibilidad |
| K05 | 24 | Baja compatibilidad | Solicitud poco definida | Baja compatibilidad |
| K06 | 85 | Excelente compatibilidad | Buena compatibilidad | Excelente compatibilidad |
| S02 | 85 | Excelente compatibilidad | Buena compatibilidad | Excelente compatibilidad |
| S08 | 80 | Excelente compatibilidad | Buena compatibilidad | Buena compatibilidad |
| S09 | 85 | Excelente compatibilidad | Buena compatibilidad | Excelente compatibilidad |
| S10 | 40 | Compatibilidad media | Baja compatibilidad | Compatibilidad media |

| Clasificación | Vigente | Alternativa A | Alternativa B |
| --- | ---: | ---: | ---: |
| Excelente compatibilidad | 22 | 11 | 17 |
| Buena compatibilidad | 6 | 15 | 11 |
| Compatibilidad media | 1 | 2 | 1 |
| Baja compatibilidad | 1 | 1 | 1 |
| Solicitud poco definida | 0 | 1 | 0 |

| | Alternativa A | Alternativa B |
| --- | --- | --- |
| Cambios | 15 escenarios cambian de nivel. | 5 escenarios bajan de «Excelente» a «Buena»: R05, C03, C04, K03, S08. |
| Ventaja | Diferencia más los resultados. | Corrige exactamente el caso «Excelente con una advertencia grave» y mantiene los demás. Es más explicable. |
| Riesgo | Una sola información pendiente (por ejemplo, tamaño o inversión, −15) bastaría para perder «Excelente» (K02, K06, S02, S09), lo que se acerca a penalizar a quien todavía no tiene datos. | Introduce una regla adicional que debe documentarse y versionarse. Algunos casos con revisión financiera de gravedad media siguen en «Excelente» (C06, K04). |

**Decisión de la dirección.** Mantener los umbrales, adoptar A o adoptar B. **Recomendación técnica: B**, por ser la de menor impacto y porque atiende directamente el problema observado.

### 14.2. Cruces económicos en stands publicitarios

- **Comportamiento actual.** Tamaño × inversión y calidad × inversión se aplican igual a stands y obras.
- **Problema.** Los rangos en m² e inversión no fueron definidos para stands. No hay evidencia de costos de stands en el sistema, y crear una matriz de costos sin datos sería arbitrario.
- **Alternativa propuesta.** No aplicar a los stands las evidencias de tamaño × inversión hasta aprobar rangos propios. Las evidencias de calidad × inversión y capital × inicio se conservan.
- **Proyección aritmética.**
  - S07 pasaría de 75 a 100, sin otras causas.
  - En S10, la causa conservaría la evidencia de lujo (−30) en lugar de −35, y quedaría en 45 en lugar de 40.
  - La coherencia financiera de S07 dejaría de pedir revisión.
- **Riesgo.** Un stand grande con un presupuesto muy bajo dejaría de señalarse automáticamente; la revisión humana debería detectarlo.
- **Limitaciones del formulario.** No pregunta si el presupuesto cubre diseño, fabricación y montaje, ni ofrece rangos de tamaño propios de stands.
- **Decisión de la dirección.** Mantener, suspender para stands o definir rangos propios con datos reales de proyectos.

### 14.3. Identificador histórico «Stands y exhibiciones»

- **Comportamiento actual.** Se evalúa como arquitectura (H01: 80) y no como Stand publicitario (H02: 100).
- **Alternativa propuesta.** Adaptación de lectura que trate el identificador histórico como Stand publicitario en la evaluación y presentación, sin transformar los datos guardados. La compatibilidad guardada no se recalcularía.
- **Riesgo.** Un registro antiguo no tiene el bloque de requisitos del stand: sus preguntas quedarían N/A. Además, la respuesta guardada sobre el inmueble dejaría de evaluarse si la solicitud se reenvía.
- **Decisión de la dirección.** Confirmar que el servicio es el mismo y aprobar la adaptación. Antes de aplicarla, conviene una consulta de solo lectura que confirme si existen registros.

### 14.4. Presentación de la información completada

- **Comportamiento actual.** Una respuesta válida de indefinición cuenta como respondida.
- **Problema.** El 100 % puede leerse como «información definida» (K05).
- **Alternativa propuesta.** Mantener el cálculo y cambiar la presentación: «Preguntas respondidas» y, aparte, el número de respuestas pendientes de definir («No lo sé aún», «Por definir», «Indefinido»). No cambia ninguna puntuación.
- **Riesgo.** Requiere un dato adicional en el contrato administrativo.
- **Decisión de la dirección.** Aprobar el cambio de nombre o presentación.

### 14.5. Proporciones y acumulación de causas económicas

- **Comportamiento actual.**
  - Tamaño desconocido y estimable: −15.
  - Inversión y capital indefinidos con inicio inmediato: −40 (R08).
- **Alternativas posibles, sin pesos nuevos inventados.**
  - Validar el −15 con casos reales.
  - Considerar que la inversión indefinida y el capital indefinido formen una sola causa de «indefinición económica», con la deducción máxima de ambas. En R08 quedaría −20 en lugar de −40: proyección aritmética, 80 en lugar de 60.
- **Riesgo.** Reducir la diferencia entre quien no define nada y quien solo no define una parte.
- **Decisión de la dirección.** Validar las magnitudes antes de configurarlas en PostgreSQL.

### 14.6. Nombre y formato visibles

- **Comportamiento actual.** «Compatibilidad con nuestros servicios», mostrada como «80%».
- **Alternativa propuesta.**
  - Nombre: «Preparación de la solicitud» o «Preparación y coherencia de la solicitud».
  - Formato: «80/100», en lugar de «80%».
- **Riesgo.** Cambia los textos que ya conocen los usuarios.
- **Decisión de la dirección.** Aprobar el nombre y el formato.

---

## 15. Recomendaciones priorizadas

| Prioridad | Recomendación | Tipo | Efecto en puntuaciones |
| --- | --- | --- | --- |
| 1 | Decidir la regla de clasificación; se recomienda la alternativa B. | Decisión de negocio | Ninguno en la puntuación; cambia el nivel de 5 escenarios |
| 2 | Mostrar «80/100» y revisar el nombre visible de la métrica. | Presentación | Ninguno |
| 3 | Suspender para stands los cruces de tamaño × inversión hasta definir rangos propios. | Regla (requiere nueva versión) | S07 y S10 en esta muestra |
| 4 | Definir el tratamiento del identificador histórico con una adaptación de lectura, sin migrar datos. | Regla y datos | Solo registros históricos, si existen |
| 5 | Presentar la información completada como «preguntas respondidas» junto al número de respuestas pendientes de definir. | Presentación | Ninguno |
| 6 | Validar con casos reales los pesos de tamaño desconocido y la acumulación de inversión y capital indefinidos. | Calibración | Por definir |
| 7 | Mejorar el formulario en una fase posterior: alcance del presupuesto, rangos de tamaño de stands y modalidad para stands. | Formulario | Por definir |
| 8 | Configurar las reglas aprobadas de forma versionada en PostgreSQL y conservar las evaluaciones históricas. | Arquitectura | Ninguno sobre registros guardados |

Las recomendaciones 3, 4 y 6 cambian resultados de compatibilidad. Si se aprueban, deberán publicarse como una nueva versión del algoritmo, con pruebas de regresión, sin recalcular las evaluaciones guardadas.

---

## 16. Decisiones pendientes de aprobación

| # | Decisión | Opciones | Recomendación técnica |
| ---: | --- | --- | --- |
| D1 | Regla de clasificación | Mantener; alternativa A; alternativa B | B |
| D2 | Cruces económicos en stands | Mantener; suspender tamaño × inversión; rangos propios aprobados | Suspender hasta disponer de rangos propios |
| D3 | Identificador histórico | Mantener el trato de arquitectura; adaptación de lectura a Stand publicitario | Adaptación de lectura, tras confirmar con una consulta de solo lectura |
| D4 | Presentación de la información completada | Mantener; «Preguntas respondidas» más respuestas pendientes de definir | Cambiar la presentación |
| D5 | Peso del tamaño desconocido (−15) | Mantener; ajustar con evidencia | Validar con casos reales |
| D6 | Acumulación de inversión y capital indefinidos | Mantener como causas independientes; unificar | Evaluar con casos reales |
| D7 | Inmueble frente al inicio en comercial y corporativo | Mantener; revisar por tipo | Evaluar con casos reales |
| D8 | Modalidad de desarrollo en stands | Mantener; tratarla como no aplicable o informativa | Revisar con el equipo de stands |
| D9 | Nombre y formato visibles | Mantener; «Preparación de la solicitud» y formato «/100» | Cambiar |

---

## 17. Conclusión técnica

El algoritmo 3.3 se comporta de acuerdo con sus reglas en los 30 escenarios:

- es determinista y explicable;
- aplica una sola deducción por causa y acumula causas independientes;
- respeta la aplicabilidad por tipo: inmueble, documentación legal, planos y tamaño estimable;
- no reintroduce penalizaciones retiradas;
- separa preparación, información completada y coherencia financiera;
- no bloquea el envío ni decide la aceptación.

Los aspectos que requieren decisión no son fallos de implementación. Son calibraciones de negocio:

- una clasificación «Excelente» amplia;
- reglas económicas comunes para obras y stands;
- el tratamiento del identificador histórico;
- la lectura de la información completada;
- la presentación al cliente.

Se recomienda aprobarlas explícitamente antes de trasladar la configuración a reglas versionadas en PostgreSQL, conservando sin cambios las evaluaciones históricas.

---

## 18. Anexo: instrucciones para reproducir las simulaciones

La simulación no dejó código en el sistema. Para reproducirla, basta con evaluar cada escenario con las funciones productivas de la versión 3.3:

| Indicador | Función del backend (`Backend/src/domain`) |
| --- | --- |
| Compatibilidad, hallazgos y deducciones | `evaluateProjectCompatibility` (`projectRequestCompatibility.js`) |
| Información completada | `evaluateProjectRequestCompleteness` (`projectRequestCompleteness.js`) |
| Coherencia financiera | `evaluateFinancialViability` (`projectRequestFinancialViability.js`) |
| Observaciones para la revisión | `buildProjectRequestReviewObservations` (`projectRequestReviewObservations.js`) |

Procedimiento:

1. Construir el registro de cada escenario a partir del perfil base de la sección 8, aplicando solo los cambios indicados en su resumen (sección 10). Las respuestas no aplicables se envían vacías, como exige el contrato.
2. Evaluar el registro con las cuatro funciones. Son funciones puras: no usan PostgreSQL, red ni almacenamiento, y no requieren credenciales.
3. Comprobar que la versión devuelta es `3.3` y que la puntuación equivale a 100 menos la suma de las deducciones de cada causa.

Los resultados son deterministas: las mismas respuestas producen siempre el mismo resultado. Si cambian las reglas o la versión del algoritmo, este análisis debe repetirse.

### Verificación complementaria del identificador histórico

| ID | Tipo | Compatibilidad | Clasificación | Información completada | Coherencia financiera | Causas y deducciones | Observaciones para la revisión |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| H01 | Stands y exhibiciones | 80 | Excelente compatibilidad | 100 % (13/13) | Sin incoherencias financieras detectadas | PROPERTY_TIMING_MISMATCH −20 | — |
| H02 | Stand publicitario | 100 | Excelente compatibilidad | 100 % (15/15) | Sin incoherencias financieras detectadas | — | — |

#### H01 — Stands y exhibiciones · Verificación complementaria

- **Respuestas relevantes:** Identificador histórico, sin inmueble e inicio inmediato; tamaño «No lo sé aún».
- **Versión:** 3.3 · **Compatibilidad:** 80 (Excelente compatibilidad) · **Cálculo:** 100 − (20) = 80
- **Información completada:** 100 % (13/13); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Sección legal y planos N/A (sin inmueble disponible). Tamaño desconocido sin deducción: no es estimable con las respuestas dadas.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| PROPERTY_TIMING_MISMATCH | TEMPORAL | HIGH | landUnavailableImmediate | −20 |
| **Total** | | | | **−20** |

#### H02 — Stand publicitario · Verificación complementaria

- **Respuestas relevantes:** Stand publicitario con respuestas equivalentes (espacio no asignado, inicio inmediato, tamaño «No lo sé aún»).
- **Versión:** 3.3 · **Compatibilidad:** 100 (Excelente compatibilidad) · **Cálculo:** 100 − 0 = 100
- **Información completada:** 100 % (15/15); pendientes: ninguna.
- **Coherencia financiera:** Sin incoherencias financieras detectadas. Hallazgos: Ninguno.
- **Observaciones para la revisión:** Ninguna.
- **Aplicabilidad:** Inmueble y sección legal N/A (Stand publicitario). Tamaño desconocido sin deducción: no es estimable con las respuestas dadas.

| Causa | Categoría | Gravedad | Evidencias | Deducción |
| --- | --- | --- | --- | ---: |
| — | — | — | — | 0 |
| **Total** | | | | **−0** |
