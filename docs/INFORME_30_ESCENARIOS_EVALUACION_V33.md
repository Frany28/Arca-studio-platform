# Evaluación de solicitudes de proyecto — Resultados de 30 escenarios ejecutados con el motor 3.3

| | |
| --- | --- |
| **Organización** | ARCA Studio |
| **Objeto** | Evaluación preliminar de solicitudes de proyecto |
| **Algoritmo** | Versión 3.3 (motor vigente del sistema) |
| **Casos ejecutados** | 30 escenarios de calibración interna |
| **Fecha de elaboración** | 4 de noviembre de 2026 |
| **Estado** | Estudio de calibración interna, pendiente de aprobación de la dirección |
| **Documento de referencia** | *Propuesta de Algoritmo de Evaluación · Solicitudes de Proyecto · Fórmula 3.3* (9 de octubre de 2026) |

> Documento generado automáticamente por `Backend/scripts/generate-evaluation-scenarios-report.mjs`. No editar a mano: los resultados proceden de la ejecución del motor y se regeneran con el script. Los escenarios son **casos simulados** diseñados para cubrir las reglas; no corresponden a clientes reales ni son los escenarios oficiales del anexo que la propuesta prevé aprobar.

## 1. Introducción

ARCA Studio recibe solicitudes preliminares de proyectos residenciales, comerciales, corporativos y de stands publicitarios. El algoritmo de evaluación apoya al administrador y al arquitecto: indica qué tan preparada está una solicitud, si sus respuestas son coherentes entre sí y qué combinaciones económicas conviene aclarar antes de crear un proyecto.

Produce tres resultados independientes:

1. **Compatibilidad** (preparación y coherencia): puntuación de 0 a 100 con una clasificación.
2. **Información completada:** porcentaje de preguntas aplicables con respuesta.
3. **Coherencia financiera orientativa:** estado cualitativo con sus motivos, sin porcentaje.

**Limitaciones de la evaluación preliminar.** La evaluación no aprueba ni rechaza proyectos, no califica la seriedad del cliente, no verifica fondos, documentos ni la situación jurídica, no estima costos reales y no determina si el presupuesto cubre diseño, ejecución o ambos. Una puntuación baja nunca impide enviar la solicitud. La compatibilidad no equivale a solvencia, rentabilidad ni viabilidad técnica.

## 2. Metodología

- **Ejecución sobre el motor real.** Los 30 casos se ejecutaron directamente con las funciones del backend `evaluateProjectCompatibility`, `evaluateProjectRequestCompleteness`, `evaluateFinancialViability` y `buildProjectRequestReviewObservations` (`Backend/src/domain`).
- **Entorno aislado y sin persistencia.** Las funciones son puras: el script no se conecta a PostgreSQL ni a Supabase, no crea solicitudes y no modifica datos.
- **Escenarios.** Son los 30 escenarios de calibración interna definidos en `Backend/tests/fixtures/projectRequestCalibrationScenarios.js`, la misma fuente que usa la prueba `projectRequestCalibrationV33.test.js`. Cada uno parte de un perfil base (arquitectura preparada o stand preparado) y cambia solo las respuestas que definen su situación.
- **Resultados.** Todas las puntuaciones, causas, porcentajes, estados y observaciones de este documento son la salida del motor. El nombre, la ubicación y la descripción son textos técnicos comunes que solo deben ser válidos y no influyen en la evaluación.
- **Reglas aplicadas por el motor** (Propuesta V3.3): la solicitud parte de 100 puntos; cada causa distinta descuenta una vez, con la deducción mayor de sus respuestas; las causas distintas se acumulan; las preguntas no aplicables (N/A) no suman, no restan ni cuentan para la información completada; la clasificación sigue los umbrales 80, 60, 40 y 20; la coherencia financiera es un estado sin puntos.

## 3. Resultados individuales

### Escenario 1 · R01 — Vivienda bien definida

**Tipo de proyecto:** Residencial. **Situación simulada:** Familia con casa propia documentada y planos que desea una remodelación pequeña con presupuesto y capital listos, sin urgencia.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 2 · R02 — Vivienda sin inmueble todavía

**Tipo de proyecto:** Residencial. **Situación simulada:** Persona que planifica una casa mediana, aún sin terreno, con presupuesto amplio y sin prisa por empezar.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Mediano (80-200 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | No todavía |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $50,000 - $150,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (13 de 13 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 3 · R03 — Vivienda con alcance pendiente

**Tipo de proyecto:** Residencial. **Situación simulada:** Propietario con inmueble disponible que no conoce el tamaño, no ha decidido la modalidad de desarrollo, no tiene planos ni aporta enlace de referencia.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | No lo sé aún |
| 06 | ¿Cómo desea desarrollar el proyecto? | Por definir |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | No |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Sin enlace (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −25 |
| Compatibilidad | **75** |
| Clasificación | Buena compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| PROJECT_SIZE_UNDEFINED | Tamaño desconocido pudiendo estimarlo | `projectSizeUndefined` | Indicar el tamaño aproximado ayudará a estimar el alcance del proyecto. | −15 |
| EXECUTION_MODE_UNDEFINED | Modalidad de desarrollo «Por definir» | `developmentModeUndefined` | Definir la modalidad de desarrollo ayudará a planificar el proyecto. | −10 |

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.

**Interpretación.** La puntuación baja por 2 causas distintas: tamaño desconocido pudiendo estimarlo (−15); modalidad de desarrollo «por definir» (−10). Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Superficie aproximada del inmueble o del espacio.
- Si el proyecto se desarrollará por fases o en su totalidad.
- El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.

### Escenario 4 · R04 — Vivienda con preguntas opcionales sin responder

**Tipo de proyecto:** Residencial. **Situación simulada:** Propietario con documentación legal en trámite que deja sin responder planos, decisor, calidad y experiencia.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | La documentación está en trámite |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sin responder (pendiente) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Sin responder (pendiente) |
| 20 | Expectativa de estilo / nivel de calidad | Sin responder (pendiente) |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sin responder (pendiente) |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −3 |
| Compatibilidad | **97** |
| Clasificación | Excelente compatibilidad |
| Información completada | 75 % (12 de 16 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| LEGAL_DOCUMENTATION_PENDING | Documentación legal del inmueble pendiente | `legalDocumentationInProcess` | La documentación legal del inmueble está en trámite y podrá revisarse más adelante. | −3 |

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** «¿Dispone de planos del lugar?», «¿Quién toma la decisión final del proyecto?», «Expectativa de estilo / nivel de calidad», «¿Ha trabajado con un arquitecto o diseñador antes?».

**Observaciones administrativas:** No se ha confirmado la disponibilidad de planos del inmueble. Se recomienda aclararlo durante la revisión inicial.

**Interpretación.** La puntuación baja por una causa: documentación legal del inmueble pendiente (−3). Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. Quedan 4 preguntas aplicables sin responder, que bajan la información completada al 75 % sin restar compatibilidad. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Situación legal del inmueble y plazo del trámite.
- Respuesta pendiente: «¿Dispone de planos del lugar?».
- Respuesta pendiente: «¿Quién toma la decisión final del proyecto?».
- Respuesta pendiente: «Expectativa de estilo / nivel de calidad».
- Respuesta pendiente: «¿Ha trabajado con un arquitecto o diseñador antes?».
- No se ha confirmado la disponibilidad de planos del inmueble. Se recomienda aclararlo durante la revisión inicial.

### Escenario 5 · R05 — Vivienda sin inmueble con inicio inmediato

**Tipo de proyecto:** Residencial. **Situación simulada:** Persona sin terreno que quiere empezar de inmediato y dispone del capital.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | No todavía |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −20 |
| Compatibilidad | **80** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (13 de 13 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| PROPERTY_TIMING_MISMATCH | Disponibilidad del inmueble frente al plazo de inicio | `landUnavailableImmediate` | Se necesita definir el inmueble antes de iniciar de inmediato. | −20 |

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: disponibilidad del inmueble frente al plazo de inicio (−20). Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Plazo en que el inmueble estará disponible.

### Escenario 6 · R06 — Vivienda en adquisición con financiamiento e inicio inmediato

**Tipo de proyecto:** Residencial. **Situación simulada:** Persona que está comprando el inmueble, busca financiamiento y quiere empezar de inmediato.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | En proceso de adquirirlo |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Busca financiamiento |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −25 |
| Compatibilidad | **75** |
| Clasificación | Buena compatibilidad |
| Información completada | 100 % (13 de 13 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `financingImmediate` | El financiamiento debe estar encaminado antes de plantear un inicio inmediato. | −15 |
| PROPERTY_TIMING_MISMATCH | Disponibilidad del inmueble frente al plazo de inicio | `landAcquiringImmediate` | La adquisición del inmueble debe coordinarse con el inicio inmediato. | −10 |

**Motivos de la coherencia financiera**

  - **CAPITAL_TIMING_MISMATCH** (financingImmediate): El financiamiento debe estar encaminado antes de plantear un inicio inmediato.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por 2 causas distintas: disponibilidad del capital frente al plazo de inicio (−15); disponibilidad del inmueble frente al plazo de inicio (−10). Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Origen de los fondos y fecha en que estarán disponibles.
- Plazo en que el inmueble estará disponible.

### Escenario 7 · R07 — Vivienda grande y premium con poco presupuesto

**Tipo de proyecto:** Residencial. **Situación simulada:** Cliente que desea una casa grande de calidad premium con menos de USD 10.000.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Grande (200-500 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | Menos de $10,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Premium |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −25 |
| Compatibilidad | **75** |
| Clasificación | Buena compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | `largeBudgetUnder10k`, `premiumBudgetUnder10k` | El rango de inversión requiere revisión para el tamaño grande indicado. | −25 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_MISMATCH** (largeBudgetUnder10k, premiumBudgetUnder10k): El rango de inversión requiere revisión para el tamaño grande indicado.
  - **BUDGET_COVERAGE_UNSPECIFIED** (budgetCoverageUnspecified): El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: inversión baja frente al tamaño o la calidad (−25). Varias respuestas apuntan a la misma causa (largeBudgetUnder10k, premiumBudgetUnder10k) y solo se descuenta la mayor, −25. Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance.
- El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

### Escenario 8 · R08 — Vivienda muy grande de lujo sin inversión ni capital definidos

**Tipo de proyecto:** Residencial. **Situación simulada:** Cliente con un proyecto muy grande de lujo, sin rango de inversión ni capital definidos, que quiere empezar de inmediato.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Residencial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Muy grande (más de 500 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | No lo tengo definido aún |
| 17 | Disponibilidad del capital | Indefinido |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Exclusivo/lujo |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −40 |
| Compatibilidad | **60** |
| Clasificación | Buena compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Riesgo financiero elevado |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_DEFINITION_INSUFFICIENT | Rango de inversión sin definir | `veryLargeBudgetUndefined`, `luxuryBudgetUndefined`, `investmentRangeUndefined`, `budgetUndefinedImmediate` | Conviene definir la inversión para evaluar el alcance del proyecto muy grande. | −20 |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `capitalUndefinedImmediate` | La disponibilidad de capital necesita aclararse para un inicio inmediato. | −20 |

**Motivos de la coherencia financiera**

  - **CAPITAL_TIMING_MISMATCH** (capitalUndefinedImmediate): La disponibilidad de capital necesita aclararse para un inicio inmediato.
  - **FINANCIAL_DEFINITION_INSUFFICIENT** (investmentRangeUndefined): Definir el rango de inversión permitirá evaluar la viabilidad del proyecto.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por 2 causas distintas: rango de inversión sin definir (−20); disponibilidad del capital frente al plazo de inicio (−20). Varias respuestas apuntan a la misma causa (veryLargeBudgetUndefined, luxuryBudgetUndefined, investmentRangeUndefined, budgetUndefinedImmediate) y solo se descuenta la mayor, −20. Coherencia financiera: hay una combinación que la propuesta considera de riesgo elevado; no demuestra que el proyecto sea inviable. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Rango presupuestario disponible para el proyecto.
- Origen de los fondos y fecha en que estarán disponibles.

### Escenario 9 · C01 — Local comercial bien definido

**Tipo de proyecto:** Comercial. **Situación simulada:** Comerciante con local arrendado, proyecto mediano por fases, presupuesto amplio e inicio en 1–3 meses.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Comercial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Mediano (80-200 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | Por fases |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Contrato de arrendamiento |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | $50,000 - $150,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | 1-3 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 10 · C02 — Local muy grande con presupuesto mínimo

**Tipo de proyecto:** Comercial. **Situación simulada:** Empresa que plantea un local de más de 500 m² con menos de USD 10.000, desarrollado por fases.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Comercial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Muy grande (más de 500 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | Por fases |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | Menos de $10,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −35 |
| Compatibilidad | **65** |
| Clasificación | Buena compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | `veryLargeBudgetUnder10k` | El rango de inversión requiere revisión para el tamaño muy grande indicado. | −35 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_MISMATCH** (veryLargeBudgetUnder10k): El rango de inversión requiere revisión para el tamaño muy grande indicado.
  - **BUDGET_COVERAGE_UNSPECIFIED** (budgetMayCoverPhase): El proyecto se desarrollará por fases: el presupuesto podría corresponder solo a una etapa; conviene confirmar su alcance.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: inversión baja frente al tamaño o la calidad (−35). Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance.
- El proyecto se desarrollará por fases: el presupuesto podría corresponder solo a una etapa; conviene confirmar su alcance.

### Escenario 11 · C03 — Local de lujo con presupuesto medio

**Tipo de proyecto:** Comercial. **Situación simulada:** Comercio que espera un acabado exclusivo con USD 10.000–50.000.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Comercial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Exclusivo/lujo |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −20 |
| Compatibilidad | **80** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | `luxuryBudget10k50k` | El nivel exclusivo o de lujo requiere revisar su coherencia con el rango de inversión. | −20 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_MISMATCH** (luxuryBudget10k50k): El nivel exclusivo o de lujo requiere revisar su coherencia con el rango de inversión.
  - **BUDGET_COVERAGE_UNSPECIFIED** (budgetCoverageUnspecified): El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: inversión baja frente al tamaño o la calidad (−20). Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance.
- El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

### Escenario 12 · C04 — Local con capital indefinido e inicio inmediato

**Tipo de proyecto:** Comercial. **Situación simulada:** Comercio que quiere empezar de inmediato sin tener definida la disponibilidad del capital.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Comercial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Indefinido |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −20 |
| Compatibilidad | **80** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Riesgo financiero elevado |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `capitalUndefinedImmediate` | La disponibilidad de capital necesita aclararse para un inicio inmediato. | −20 |

**Motivos de la coherencia financiera**

  - **CAPITAL_TIMING_MISMATCH** (capitalUndefinedImmediate): La disponibilidad de capital necesita aclararse para un inicio inmediato.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: disponibilidad del capital frente al plazo de inicio (−20). Coherencia financiera: hay una combinación que la propuesta considera de riesgo elevado; no demuestra que el proyecto sea inviable. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Origen de los fondos y fecha en que estarán disponibles.

### Escenario 13 · C05 — Local con financiamiento y plazo flexible

**Tipo de proyecto:** Comercial. **Situación simulada:** Comercio que busca financiamiento y prevé empezar en 3–6 meses.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Comercial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Busca financiamiento |
| 18 | ¿Cuándo espera iniciar el proyecto? | 3-6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 14 · C06 — Local sin documentación legal y capital a tres meses

**Tipo de proyecto:** Comercial. **Situación simulada:** Comercio con local disponible sin documentación ni planos, capital en tres meses e inicio inmediato.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Comercial |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | No dispongo de documentación |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | No |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | En los próximos 3 meses |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −16 |
| Compatibilidad | **84** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `capitalWithin3MonthsImmediate` | La disponibilidad de capital en tres meses debe coordinarse con el inicio inmediato. | −10 |
| LEGAL_DOCUMENTATION_PENDING | Documentación legal del inmueble pendiente | `legalDocumentationUnavailable` | Contar con documentación legal del inmueble facilitará el inicio del proyecto. | −6 |

**Motivos de la coherencia financiera**

  - **CAPITAL_TIMING_MISMATCH** (capitalWithin3MonthsImmediate): La disponibilidad de capital en tres meses debe coordinarse con el inicio inmediato.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.

**Interpretación.** La puntuación baja por 2 causas distintas: disponibilidad del capital frente al plazo de inicio (−10); documentación legal del inmueble pendiente (−6). Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Origen de los fondos y fecha en que estarán disponibles.
- Situación legal del inmueble y plazo del trámite.
- El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos.

### Escenario 15 · K01 — Oficina corporativa bien definida

**Tipo de proyecto:** Corporativo. **Situación simulada:** Empresa con decisión por junta, oficina grande premium, más de USD 150.000 e inicio en 3–6 meses.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Corporativo |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Grande (200-500 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | Más de $150,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | 3-6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Empresa/junta |
| 20 | Expectativa de estilo / nivel de calidad | Premium |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 16 · K02 — Oficina grande sin inversión definida

**Tipo de proyecto:** Corporativo. **Situación simulada:** Empresa con un proyecto grande que todavía no ha definido el rango de inversión.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Corporativo |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Grande (200-500 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | No lo tengo definido aún |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −15 |
| Compatibilidad | **85** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Información financiera insuficiente |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_DEFINITION_INSUFFICIENT | Rango de inversión sin definir | `investmentRangeUndefined`, `largeBudgetUndefined` | Definir el rango de inversión permitirá evaluar la viabilidad del proyecto. | −15 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_DEFINITION_INSUFFICIENT** (investmentRangeUndefined): Definir el rango de inversión permitirá evaluar la viabilidad del proyecto.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: rango de inversión sin definir (−15). Varias respuestas apuntan a la misma causa (investmentRangeUndefined, largeBudgetUndefined) y solo se descuenta la mayor, −15. Coherencia financiera: faltan datos para contrastar la inversión con el alcance del proyecto. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Rango presupuestario disponible para el proyecto.

### Escenario 17 · K03 — Oficina pequeña premium con poco presupuesto

**Tipo de proyecto:** Corporativo. **Situación simulada:** Empresa que espera calidad premium en un espacio pequeño con menos de USD 10.000.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Corporativo |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | Menos de $10,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Premium |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −20 |
| Compatibilidad | **80** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (17 de 17 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | `premiumBudgetUnder10k` | El nivel premium requiere revisar su coherencia con el rango de inversión. | −20 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_MISMATCH** (premiumBudgetUnder10k): El nivel premium requiere revisar su coherencia con el rango de inversión.
  - **BUDGET_COVERAGE_UNSPECIFIED** (budgetCoverageUnspecified): El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: inversión baja frente al tamaño o la calidad (−20). Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance.
- El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

### Escenario 18 · K04 — Oficina sin inmueble, tamaño desconocido y capital indefinido

**Tipo de proyecto:** Corporativo. **Situación simulada:** Empresa sin oficina todavía, sin conocer el tamaño, con capital indefinido e inicio en 1–3 meses.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Corporativo |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | No lo sé aún |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | No todavía |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Indefinido |
| 18 | ¿Cuándo espera iniciar el proyecto? | 1-3 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −20 |
| Compatibilidad | **80** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (13 de 13 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `capitalUndefinedSoon` | La disponibilidad de capital necesita aclararse para iniciar en los próximos meses. | −10 |
| PROPERTY_TIMING_MISMATCH | Disponibilidad del inmueble frente al plazo de inicio | `landUnavailableSoon` | Se necesita avanzar en la definición del inmueble antes del inicio previsto. | −10 |

**Motivos de la coherencia financiera**

  - **CAPITAL_TIMING_MISMATCH** (capitalUndefinedSoon): La disponibilidad de capital necesita aclararse para iniciar en los próximos meses.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por 2 causas distintas: disponibilidad del capital frente al plazo de inicio (−10); disponibilidad del inmueble frente al plazo de inicio (−10). Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Origen de los fondos y fecha en que estarán disponibles.
- Plazo en que el inmueble estará disponible.

### Escenario 19 · K05 — Oficina con múltiples contradicciones

**Tipo de proyecto:** Corporativo. **Situación simulada:** Empresa con inmueble sin documentación, tamaño desconocido, modalidad por definir, lujo con menos de USD 10.000, financiamiento e inicio inmediato.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Corporativo |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | No lo sé aún |
| 06 | ¿Cómo desea desarrollar el proyecto? | Por definir |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | No dispongo de documentación |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | Menos de $10,000 USD |
| 17 | Disponibilidad del capital | Busca financiamiento |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Exclusivo/lujo |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −76 |
| Compatibilidad | **24** |
| Clasificación | Baja compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | `luxuryBudgetUnder10k` | El nivel exclusivo o de lujo requiere revisar su coherencia con el rango de inversión. | −30 |
| PROJECT_SIZE_UNDEFINED | Tamaño desconocido pudiendo estimarlo | `projectSizeUndefined` | Indicar el tamaño aproximado ayudará a estimar el alcance del proyecto. | −15 |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `financingImmediate` | El financiamiento debe estar encaminado antes de plantear un inicio inmediato. | −15 |
| EXECUTION_MODE_UNDEFINED | Modalidad de desarrollo «Por definir» | `developmentModeUndefined`, `modeUndefinedImmediate` | Definir la modalidad de desarrollo ayudará a planificar el proyecto. | −10 |
| LEGAL_DOCUMENTATION_PENDING | Documentación legal del inmueble pendiente | `legalDocumentationUnavailable` | Contar con documentación legal del inmueble facilitará el inicio del proyecto. | −6 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_MISMATCH** (luxuryBudgetUnder10k): El nivel exclusivo o de lujo requiere revisar su coherencia con el rango de inversión.
  - **CAPITAL_TIMING_MISMATCH** (financingImmediate): El financiamiento debe estar encaminado antes de plantear un inicio inmediato.
  - **BUDGET_COVERAGE_UNSPECIFIED** (budgetCoverageUnspecified): El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por 5 causas distintas: inversión baja frente al tamaño o la calidad (−30); tamaño desconocido pudiendo estimarlo (−15); disponibilidad del capital frente al plazo de inicio (−15); modalidad de desarrollo «por definir» (−10); documentación legal del inmueble pendiente (−6). Varias respuestas apuntan a la misma causa (developmentModeUndefined, modeUndefinedImmediate) y solo se descuenta la mayor, −10. Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance.
- Superficie aproximada del inmueble o del espacio.
- Origen de los fondos y fecha en que estarán disponibles.
- Si el proyecto se desarrollará por fases o en su totalidad.
- Situación legal del inmueble y plazo del trámite.
- El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

### Escenario 20 · K06 — Oficina con datos opcionales pendientes

**Tipo de proyecto:** Corporativo. **Situación simulada:** Empresa con inmueble disponible que deja sin responder tamaño, calidad, decisor y experiencia, y no aporta enlace de referencia.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Corporativo |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Sin responder (pendiente) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | Sí, disponible |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | N/A (no aplica) |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | N/A (no aplica) |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | N/A (no aplica) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible |
| 13 | Documentación disponible (inmueble) | Documento de propiedad |
| 14 | ¿El inmueble tiene más de un propietario? | No |
| 15 | ¿Dispone de planos del lugar? | Sí |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Sin responder (pendiente) |
| 20 | Expectativa de estilo / nivel de calidad | Sin responder (pendiente) |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sin responder (pendiente) |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Sin enlace (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −15 |
| Compatibilidad | **85** |
| Clasificación | Excelente compatibilidad |
| Información completada | 76 % (13 de 17 preguntas aplicables) |
| Coherencia financiera | Información financiera insuficiente |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| PROJECT_SIZE_UNDEFINED | Tamaño desconocido pudiendo estimarlo | `projectSizeUndefined` | Indicar el tamaño aproximado ayudará a estimar el alcance del proyecto. | −15 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_UNDEFINED** (financialScopeUndefined): Sin tamaño ni calidad esperada no es posible contrastar el presupuesto con el alcance del proyecto.

**Preguntas pendientes:** «Tamaño aproximado del proyecto», «¿Quién toma la decisión final del proyecto?», «Expectativa de estilo / nivel de calidad», «¿Ha trabajado con un arquitecto o diseñador antes?».

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: tamaño desconocido pudiendo estimarlo (−15). Coherencia financiera: faltan datos para contrastar la inversión con el alcance del proyecto. Quedan 4 preguntas aplicables sin responder, que bajan la información completada al 76 % sin restar compatibilidad. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Superficie aproximada del inmueble o del espacio.
- Sin tamaño ni calidad esperada no es posible contrastar el presupuesto con el alcance del proyecto.
- Respuesta pendiente: «Tamaño aproximado del proyecto».
- Respuesta pendiente: «¿Quién toma la decisión final del proyecto?».
- Respuesta pendiente: «Expectativa de estilo / nivel de calidad».
- Respuesta pendiente: «¿Ha trabajado con un arquitecto o diseñador antes?».

### Escenario 21 · S01 — Stand bien definido

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor con espacio asignado y medidas, manual del expositor, stand pequeño y presupuesto definido.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Manual del expositor |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sí |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 22 · S02 — Stand asignado con medidas y tamaño desconocido

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor que tiene el espacio asignado y sus medidas, pero marca el tamaño como desconocido.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | No lo sé aún |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Manual del expositor |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sí |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −15 |
| Compatibilidad | **85** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| PROJECT_SIZE_UNDEFINED | Tamaño desconocido pudiendo estimarlo | `projectSizeUndefined` | Indicar el tamaño aproximado ayudará a estimar el alcance del proyecto. | −15 |

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: tamaño desconocido pudiendo estimarlo (−15). Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Superficie aproximada del inmueble o del espacio.

### Escenario 23 · S03 — Stand asignado sin medidas

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor con espacio asignado pero sin medidas y con tamaño desconocido.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | No lo sé aún |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Manual del expositor |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | No |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 24 · S04 — Stand con asignación y normas en trámite

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor con espacio y normas en trámite que no responde si tiene medidas y desconoce el tamaño.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | No lo sé aún |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Estoy gestionando los requisitos |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | La asignación está en proceso |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sin responder (pendiente) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 93 % (14 de 15 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** «¿Tienes las medidas o plano del espacio asignado?».

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. Quedan 1 pregunta aplicable sin responder, que bajan la información completada al 93 % sin restar compatibilidad. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Respuesta pendiente: «¿Tienes las medidas o plano del espacio asignado?».

### Escenario 25 · S05 — Stand sin espacio ni normas e inicio inmediato

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor sin espacio asignado ni normas, sin medidas, que quiere empezar de inmediato.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Aún no tengo los requisitos |
| 09 | Documentación disponible (evento) | N/A (no aplica) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Aún no está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | No |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (15 de 15 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Confirmar en la reunión inicial el alcance concreto del trabajo.

### Escenario 26 · S06 — Stand con normas sin documentos seleccionados

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor con normas disponibles que no selecciona documentos ni responde si tiene medidas.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Sin responder (pendiente) |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sin responder (pendiente) |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −0 |
| Compatibilidad | **100** |
| Clasificación | Excelente compatibilidad |
| Información completada | 88 % (14 de 16 preguntas aplicables) |
| Coherencia financiera | Sin incoherencias financieras detectadas |

**Deducciones por causa**

Ninguna causa activada.

**Motivos de la coherencia financiera**

  - Ninguno.

**Preguntas pendientes:** «Documentación disponible (evento)», «¿Tienes las medidas o plano del espacio asignado?».

**Observaciones administrativas:** Ninguna.

**Interpretación.** La solicitud no presenta indefiniciones ni contradicciones que resten puntos. Coherencia financiera: las reglas disponibles no encuentran contradicciones económicas; no equivale a una aprobación financiera. Quedan 2 preguntas aplicables sin responder, que bajan la información completada al 88 % sin restar compatibilidad. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Respuesta pendiente: «Documentación disponible (evento)».
- Respuesta pendiente: «¿Tienes las medidas o plano del espacio asignado?».

### Escenario 27 · S07 — Stand grande con poco presupuesto

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor con un stand grande (200–500 m²) y menos de USD 10.000.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Grande (200-500 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Manual del expositor |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sí |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | Menos de $10,000 USD |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | Más de 6 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −25 |
| Compatibilidad | **75** |
| Clasificación | Buena compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | `largeBudgetUnder10k` | El rango de inversión requiere revisión para el tamaño grande indicado. | −25 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_MISMATCH** (largeBudgetUnder10k): El rango de inversión requiere revisión para el tamaño grande indicado.
  - **BUDGET_COVERAGE_UNSPECIFIED** (budgetCoverageUnspecified): El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: inversión baja frente al tamaño o la calidad (−25). Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance.
- El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

### Escenario 28 · S08 — Stand con capital indefinido e inicio inmediato

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor que quiere empezar de inmediato sin capital definido.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Manual del expositor |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sí |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | $10,000 - $50,000 USD |
| 17 | Disponibilidad del capital | Indefinido |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Calidad estándar |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −20 |
| Compatibilidad | **80** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Riesgo financiero elevado |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `capitalUndefinedImmediate` | La disponibilidad de capital necesita aclararse para un inicio inmediato. | −20 |

**Motivos de la coherencia financiera**

  - **CAPITAL_TIMING_MISMATCH** (capitalUndefinedImmediate): La disponibilidad de capital necesita aclararse para un inicio inmediato.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: disponibilidad del capital frente al plazo de inicio (−20). Coherencia financiera: hay una combinación que la propuesta considera de riesgo elevado; no demuestra que el proyecto sea inviable. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Origen de los fondos y fecha en que estarán disponibles.

### Escenario 29 · S09 — Stand premium sin inversión definida

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor que espera calidad premium sin rango de inversión e inicio en 1–3 meses.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Pequeño (menos de 80 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | En su totalidad |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Manual del expositor |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sí |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | No lo tengo definido aún |
| 17 | Disponibilidad del capital | Disponible ahora |
| 18 | ¿Cuándo espera iniciar el proyecto? | 1-3 meses |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Premium |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −15 |
| Compatibilidad | **85** |
| Clasificación | Excelente compatibilidad |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Información financiera insuficiente |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_DEFINITION_INSUFFICIENT | Rango de inversión sin definir | `investmentRangeUndefined`, `premiumBudgetUndefined`, `budgetUndefinedSoon` | Definir el rango de inversión permitirá evaluar la viabilidad del proyecto. | −15 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_DEFINITION_INSUFFICIENT** (investmentRangeUndefined): Definir el rango de inversión permitirá evaluar la viabilidad del proyecto.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por una causa: rango de inversión sin definir (−15). Varias respuestas apuntan a la misma causa (investmentRangeUndefined, premiumBudgetUndefined, budgetUndefinedSoon) y solo se descuenta la mayor, −15. Coherencia financiera: faltan datos para contrastar la inversión con el alcance del proyecto. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Rango presupuestario disponible para el proyecto.

### Escenario 30 · S10 — Stand muy grande de lujo con presupuesto mínimo

**Tipo de proyecto:** Stand publicitario. **Situación simulada:** Expositor con stand muy grande de lujo, menos de USD 10.000, modalidad por definir, financiamiento e inicio inmediato.

**Respuestas del formulario**

| Input | Pregunta | Respuesta |
| --- | --- | --- |
| 01 | Nombre del proyecto | Texto válido de 24 caracteres (valor técnico común; no influye en la evaluación) |
| 02 | Tipo de proyecto | Stand publicitario |
| 03 | Ubicación del proyecto | Texto válido de 23 caracteres (valor técnico común; no influye en la evaluación) |
| 04 | Descripción del proyecto | Texto válido de 58 caracteres (valor técnico común; no influye en la evaluación) |
| 05 | Tamaño aproximado del proyecto | Muy grande (más de 500 m²) |
| 06 | ¿Cómo desea desarrollar el proyecto? | Por definir |
| 07 | ¿Tiene terreno o inmueble disponible? | N/A (no aplica) |
| 08 | ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos |
| 09 | Documentación disponible (evento) | Manual del expositor |
| 10 | ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado |
| 11 | ¿Tienes las medidas o plano del espacio asignado? | Sí |
| 12 | ¿Cuenta con documentación que acredite la situación legal del inmueble? | N/A (no aplica) |
| 13 | Documentación disponible (inmueble) | N/A (no aplica) |
| 14 | ¿El inmueble tiene más de un propietario? | N/A (no aplica) |
| 15 | ¿Dispone de planos del lugar? | N/A (no aplica) |
| 16 | Rango de inversión estimado | Menos de $10,000 USD |
| 17 | Disponibilidad del capital | Busca financiamiento |
| 18 | ¿Cuándo espera iniciar el proyecto? | De inmediato |
| 19 | ¿Quién toma la decisión final del proyecto? | Yo solo/a |
| 20 | Expectativa de estilo / nivel de calidad | Exclusivo/lujo |
| 21 | ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia |
| 22 | Subir imágenes o archivos | No incluido (opcional; no puntúa ni cuenta para la información completada) |
| 23 | Link de referencia | Enlace http/https registrado (opcional; no puntúa ni cuenta para la información completada) |

**Resultados del motor (versión 3.3)**

| Indicador | Resultado |
| --- | --- |
| Puntuación inicial | 100 |
| Total descontado | −60 |
| Compatibilidad | **40** |
| Clasificación | Compatibilidad media |
| Información completada | 100 % (16 de 16 preguntas aplicables) |
| Coherencia financiera | Requiere revisión financiera |

**Deducciones por causa**

| Causa | Descripción | Evidencias | Explicación del motor | Deducción |
| --- | --- | --- | --- | ---: |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | `veryLargeBudgetUnder10k`, `luxuryBudgetUnder10k` | El rango de inversión requiere revisión para el tamaño muy grande indicado. | −35 |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | `financingImmediate` | El financiamiento debe estar encaminado antes de plantear un inicio inmediato. | −15 |
| EXECUTION_MODE_UNDEFINED | Modalidad de desarrollo «Por definir» | `developmentModeUndefined`, `modeUndefinedImmediate` | Definir la modalidad de desarrollo ayudará a planificar el proyecto. | −10 |

**Motivos de la coherencia financiera**

  - **FINANCIAL_SCOPE_MISMATCH** (veryLargeBudgetUnder10k, luxuryBudgetUnder10k): El rango de inversión requiere revisión para el tamaño muy grande indicado.
  - **CAPITAL_TIMING_MISMATCH** (financingImmediate): El financiamiento debe estar encaminado antes de plantear un inicio inmediato.
  - **BUDGET_COVERAGE_UNSPECIFIED** (budgetCoverageUnspecified): El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

**Preguntas pendientes:** ninguna.

**Observaciones administrativas:** Ninguna.

**Interpretación.** La puntuación baja por 3 causas distintas: inversión baja frente al tamaño o la calidad (−35); disponibilidad del capital frente al plazo de inicio (−15); modalidad de desarrollo «por definir» (−10). Varias respuestas apuntan a la misma causa (veryLargeBudgetUnder10k, luxuryBudgetUnder10k) y solo se descuenta la mayor, −35. Varias respuestas apuntan a la misma causa (developmentModeUndefined, modeUndefinedImmediate) y solo se descuenta la mayor, −10. Coherencia financiera: hay un cruce económico que conviene aclarar con el cliente. La puntuación no aprueba ni rechaza la solicitud: orienta la revisión del administrador y del arquitecto.

**Aspectos a aclarar**

- Qué cubre el presupuesto (diseño, una fase o la ejecución) y su relación con el alcance.
- Origen de los fondos y fecha en que estarán disponibles.
- Si el proyecto se desarrollará por fases o en su totalidad.
- El formulario no indica si el presupuesto cubre solo el diseño o también la ejecución; conviene confirmarlo antes de concluir.

## 4. Tabla comparativa

| N.º | ID | Tipo | Escenario | Compatibilidad | Clasificación | Información completada | Coherencia financiera | Causas |
| ---: | --- | --- | --- | ---: | --- | --- | --- | --- |
| 1 | R01 | Residencial | Vivienda bien definida | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — |
| 2 | R02 | Residencial | Vivienda sin inmueble todavía | 100 | Excelente compatibilidad | 100 % (13/13) | Sin incoherencias financieras detectadas | — |
| 3 | R03 | Residencial | Vivienda con alcance pendiente | 75 | Buena compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | PROJECT_SIZE_UNDEFINED −15; EXECUTION_MODE_UNDEFINED −10 |
| 4 | R04 | Residencial | Vivienda con preguntas opcionales sin responder | 97 | Excelente compatibilidad | 75 % (12/16) | Sin incoherencias financieras detectadas | LEGAL_DOCUMENTATION_PENDING −3 |
| 5 | R05 | Residencial | Vivienda sin inmueble con inicio inmediato | 80 | Excelente compatibilidad | 100 % (13/13) | Sin incoherencias financieras detectadas | PROPERTY_TIMING_MISMATCH −20 |
| 6 | R06 | Residencial | Vivienda en adquisición con financiamiento e inicio inmediato | 75 | Buena compatibilidad | 100 % (13/13) | Requiere revisión financiera | CAPITAL_TIMING_MISMATCH −15; PROPERTY_TIMING_MISMATCH −10 |
| 7 | R07 | Residencial | Vivienda grande y premium con poco presupuesto | 75 | Buena compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −25 |
| 8 | R08 | Residencial | Vivienda muy grande de lujo sin inversión ni capital definidos | 60 | Buena compatibilidad | 100 % (17/17) | Riesgo financiero elevado | FINANCIAL_DEFINITION_INSUFFICIENT −20; CAPITAL_TIMING_MISMATCH −20 |
| 9 | C01 | Comercial | Local comercial bien definido | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — |
| 10 | C02 | Comercial | Local muy grande con presupuesto mínimo | 65 | Buena compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −35 |
| 11 | C03 | Comercial | Local de lujo con presupuesto medio | 80 | Excelente compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −20 |
| 12 | C04 | Comercial | Local con capital indefinido e inicio inmediato | 80 | Excelente compatibilidad | 100 % (17/17) | Riesgo financiero elevado | CAPITAL_TIMING_MISMATCH −20 |
| 13 | C05 | Comercial | Local con financiamiento y plazo flexible | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — |
| 14 | C06 | Comercial | Local sin documentación legal y capital a tres meses | 84 | Excelente compatibilidad | 100 % (16/16) | Requiere revisión financiera | CAPITAL_TIMING_MISMATCH −10; LEGAL_DOCUMENTATION_PENDING −6 |
| 15 | K01 | Corporativo | Oficina corporativa bien definida | 100 | Excelente compatibilidad | 100 % (17/17) | Sin incoherencias financieras detectadas | — |
| 16 | K02 | Corporativo | Oficina grande sin inversión definida | 85 | Excelente compatibilidad | 100 % (17/17) | Información financiera insuficiente | FINANCIAL_DEFINITION_INSUFFICIENT −15 |
| 17 | K03 | Corporativo | Oficina pequeña premium con poco presupuesto | 80 | Excelente compatibilidad | 100 % (17/17) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −20 |
| 18 | K04 | Corporativo | Oficina sin inmueble, tamaño desconocido y capital indefinido | 80 | Excelente compatibilidad | 100 % (13/13) | Requiere revisión financiera | CAPITAL_TIMING_MISMATCH −10; PROPERTY_TIMING_MISMATCH −10 |
| 19 | K05 | Corporativo | Oficina con múltiples contradicciones | 24 | Baja compatibilidad | 100 % (16/16) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −30; PROJECT_SIZE_UNDEFINED −15; CAPITAL_TIMING_MISMATCH −15; EXECUTION_MODE_UNDEFINED −10; LEGAL_DOCUMENTATION_PENDING −6 |
| 20 | K06 | Corporativo | Oficina con datos opcionales pendientes | 85 | Excelente compatibilidad | 76 % (13/17) | Información financiera insuficiente | PROJECT_SIZE_UNDEFINED −15 |
| 21 | S01 | Stand publicitario | Stand bien definido | 100 | Excelente compatibilidad | 100 % (16/16) | Sin incoherencias financieras detectadas | — |
| 22 | S02 | Stand publicitario | Stand asignado con medidas y tamaño desconocido | 85 | Excelente compatibilidad | 100 % (16/16) | Sin incoherencias financieras detectadas | PROJECT_SIZE_UNDEFINED −15 |
| 23 | S03 | Stand publicitario | Stand asignado sin medidas | 100 | Excelente compatibilidad | 100 % (16/16) | Sin incoherencias financieras detectadas | — |
| 24 | S04 | Stand publicitario | Stand con asignación y normas en trámite | 100 | Excelente compatibilidad | 93 % (14/15) | Sin incoherencias financieras detectadas | — |
| 25 | S05 | Stand publicitario | Stand sin espacio ni normas e inicio inmediato | 100 | Excelente compatibilidad | 100 % (15/15) | Sin incoherencias financieras detectadas | — |
| 26 | S06 | Stand publicitario | Stand con normas sin documentos seleccionados | 100 | Excelente compatibilidad | 88 % (14/16) | Sin incoherencias financieras detectadas | — |
| 27 | S07 | Stand publicitario | Stand grande con poco presupuesto | 75 | Buena compatibilidad | 100 % (16/16) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −25 |
| 28 | S08 | Stand publicitario | Stand con capital indefinido e inicio inmediato | 80 | Excelente compatibilidad | 100 % (16/16) | Riesgo financiero elevado | CAPITAL_TIMING_MISMATCH −20 |
| 29 | S09 | Stand publicitario | Stand premium sin inversión definida | 85 | Excelente compatibilidad | 100 % (16/16) | Información financiera insuficiente | FINANCIAL_DEFINITION_INSUFFICIENT −15 |
| 30 | S10 | Stand publicitario | Stand muy grande de lujo con presupuesto mínimo | 40 | Compatibilidad media | 100 % (16/16) | Requiere revisión financiera | FINANCIAL_SCOPE_MISMATCH −35; CAPITAL_TIMING_MISMATCH −15; EXECUTION_MODE_UNDEFINED −10 |

## 5. Análisis general

**Mayor y menor compatibilidad.** 10 escenarios alcanzan la máxima puntuación (100): R01 (100), R02 (100), C01 (100), C05 (100), K01 (100), S01 (100), S03 (100), S04 (100), S05 (100), S06 (100). Las puntuaciones más bajas son K05 (24), S10 (40), R08 (60).

**Solicitudes completas con contradicciones.** 18 escenarios tienen el 100 % de la información completada y, aun así, causas de deducción o advertencias financieras: R03 (75), R05 (80), R06 (75), R07 (75), R08 (60), C02 (65), C03 (80), C04 (80), C06 (84), K02 (85), K03 (80), K04 (80), K05 (24), S02 (85), S07 (75), S08 (80), S09 (85), S10 (40). Responder todas las preguntas no garantiza una solicitud preparada: «No lo sé aún», «Por definir» o «Indefinido» cuentan como respuestas.

**Solicitudes incompletas pero coherentes.** 2 escenarios tienen preguntas pendientes y ninguna causa de deducción: S04 (100), S06 (100). Las preguntas opcionales sin responder bajan la información completada, no la compatibilidad. Con preguntas pendientes y alguna causa: R04 (97), K06 (85).

**Inconsistencias financieras más frecuentes.** Hallazgos de la coherencia financiera: CAPITAL_TIMING_MISMATCH (8), FINANCIAL_SCOPE_MISMATCH (7), BUDGET_COVERAGE_UNSPECIFIED (7), FINANCIAL_DEFINITION_INSUFFICIENT (3), FINANCIAL_SCOPE_UNDEFINED (1). 9 escenarios en «Excelente compatibilidad» presentan una advertencia financiera: C03 (Requiere revisión financiera), C04 (Riesgo financiero elevado), C06 (Requiere revisión financiera), K02 (Información financiera insuficiente), K03 (Requiere revisión financiera), K04 (Requiere revisión financiera), K06 (Información financiera insuficiente), S08 (Riesgo financiero elevado), S09 (Información financiera insuficiente).

**Diferencias entre tipos de proyecto.**

| Tipo | Casos | Promedio | Mínima | Máxima |
| --- | ---: | ---: | ---: | ---: |
| Residencial | 8 | 82,8 | 60 | 100 |
| Comercial | 6 | 84,8 | 65 | 100 |
| Corporativo | 6 | 75,7 | 24 | 100 |
| Stand publicitario | 10 | 86,5 | 40 | 100 |

Las diferencias reflejan las situaciones elegidas en cada grupo, no un trato distinto por tipo: las reglas son comunes, salvo las propias de los stands.

**Situaciones especiales de los stands.** En los 10 stands no se pregunta por inmueble ni documentación legal. El tamaño desconocido no resta cuando no es estimable (S03 (100), S04 (100)). Con inicio inmediato (S05 (100), S08 (80), S10 (40)) no se aplica el cruce de inmueble frente al inicio. Los cruces económicos usan provisionalmente la misma matriz que la arquitectura (S07 (75), S10 (40)); su tratamiento propio está pendiente de decisión de la dirección.

**Una causa, una deducción.** En 6 escenarios varias respuestas apuntan a una misma causa y solo se descuenta la mayor: R07 (75), R08 (60), K02 (85), K05 (24), S09 (85), S10 (40).

**Casos que requieren revisión administrativa.** 15 escenarios combinan dos o más causas, una advertencia financiera de revisión o riesgo, u observaciones administrativas: R03 (75), R04 (97), R06 (75), R07 (75), R08 (60), C02 (65), C03 (80), C04 (80), C06 (84), K03 (80), K04 (80), K05 (24), S07 (75), S08 (80), S10 (40). Requieren una conversación con el cliente antes de avanzar.

**Independencia de las tres métricas.** Se observa en los propios resultados: compatibilidad 100 con información incompleta (S04: 93 %, S06: 88 %); información completa con compatibilidad inferior a 80 (R03 (75), R06 (75), R07 (75), R08 (60), C02 (65), K05 (24), S07 (75), S10 (40)); y «Excelente compatibilidad» con riesgo financiero elevado (C04 (80), S08 (80)). Ninguna métrica se deriva de otra.

## 6. Estadísticas

| Indicador | Valor |
| --- | --- |
| Escenarios ejecutados | 30 |
| Promedio de compatibilidad | 83,0 |
| Puntuación máxima | 100 (R01, R02, C01, C05, K01, S01, S03, S04, S05, S06) |
| Puntuación mínima | 24 (K05) |
| Casos con información completada al 100 % | 26 de 30 |
| Casos sin ninguna causa de deducción | 10 de 30 |

**Distribución por clasificación**

| Clasificación | Casos |
| --- | ---: |
| Excelente compatibilidad | 22 |
| Buena compatibilidad | 6 |
| Compatibilidad media | 1 |
| Baja compatibilidad | 1 |
| Solicitud poco definida | 0 |

**Distribución por estado financiero**

| Estado | Casos |
| --- | ---: |
| Sin incoherencias financieras detectadas | 14 |
| Requiere revisión financiera | 10 |
| Riesgo financiero elevado | 3 |
| Información financiera insuficiente | 3 |
| Pendiente de reglas de evaluación | 0 |

**Frecuencia de cada causa de deducción** (número de escenarios en que aparece)

| Causa | Descripción | Escenarios |
| --- | --- | ---: |
| CAPITAL_TIMING_MISMATCH | Disponibilidad del capital frente al plazo de inicio | 8 |
| FINANCIAL_SCOPE_MISMATCH | Inversión baja frente al tamaño o la calidad | 7 |
| PROJECT_SIZE_UNDEFINED | Tamaño desconocido pudiendo estimarlo | 4 |
| EXECUTION_MODE_UNDEFINED | Modalidad de desarrollo «Por definir» | 3 |
| LEGAL_DOCUMENTATION_PENDING | Documentación legal del inmueble pendiente | 3 |
| PROPERTY_TIMING_MISMATCH | Disponibilidad del inmueble frente al plazo de inicio | 3 |
| FINANCIAL_DEFINITION_INSUFFICIENT | Rango de inversión sin definir | 3 |

## 7. Conclusiones

**Comportamiento observado.** En los 30 casos el motor aplica una sola deducción por causa, acumula causas independientes, respeta las preguntas no aplicables y no penaliza el material opcional (archivos, enlaces y planos). La clasificación «Excelente» concentra 22 casos, y una sola causa de −20 deja una solicitud exactamente en el límite inferior de esa clasificación, por lo que la compatibilidad debe leerse siempre junto con la coherencia financiera y la información completada.

**Decisiones que corresponden a cada rol.**

- **Administración:** aclarar con el cliente las causas activadas, las respuestas pendientes y los motivos financieros de cada solicitud; atender las observaciones sobre planos.
- **Arquitectura:** valorar el alcance técnico real (superficie, modalidad, levantamiento de planos) y si el presupuesto es razonable para lo solicitado.
- **Dirección:** decidir si se mantiene provisionalmente la matriz económica común para los stands o se definen rangos propios, y aprobar estos 30 escenarios como anexo oficial o sustituirlos. Cualquier ajuste de deducciones o umbrales debería basarse en solicitudes reales y no en estos casos simulados.

## 8. Verificación

| Comprobación | Resultado |
| --- | --- |
| Escenarios ejecutados | 30 |
| Versión del motor | 3.3 |
| Reglas estructurales (100 − Σ deducciones, una causa una vez, umbrales, redondeo, sin porcentaje financiero) | Cumplidas en los 30 casos |
| Coincidencia con la prueba de calibración `projectRequestCalibrationV33.test.js` | 30 de 30 |

No se encontraron diferencias entre el motor, las reglas de la propuesta y la prueba de calibración.

Para regenerar el informe: `node scripts/generate-evaluation-scenarios-report.mjs` (desde `Backend`). Para comprobar que está al día sin escribirlo: `node scripts/generate-evaluation-scenarios-report.mjs --check`.
