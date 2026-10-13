# Propuesta de Cálculo de Compatibilidad de Solicitudes de Proyecto V3 — ARCA Studio

## 1. Objetivo y versión

Presentar a la dirección de ARCA Studio la evaluación inicial de solicitudes de proyectos, versión **3.3**, para su revisión y aprobación. La propuesta consolida el comportamiento implementado y conserva los valores de deducción existentes; esta actualización no incorpora pesos, bonificaciones ni porcentajes nuevos.

- La versión 3.1 corrigió qué preguntas aplican a un «Stand publicitario».
- La versión 3.2 retira las deducciones por no adjuntar archivos o enlace de referencia.
- La versión 3.3 retira la deducción por planos del inmueble y solo resta por tamaño desconocido cuando el cliente puede estimarlo.

La compatibilidad mide la preparación y coherencia de una solicitud preliminar. No constituye una evaluación técnica definitiva ni determina la aceptación del proyecto. La información será revisada por el administrador y el arquitecto antes de crear un proyecto. La información pendiente no indica falta de seriedad ni de compromiso del cliente.

La evaluación ofrece tres resultados independientes:

| Resultado | Propósito |
| --- | --- |
| Compatibilidad | Identificar preparación, definición del alcance y coherencia entre las respuestas, en una escala de 0 a 100. |
| Información completada | Mostrar qué porcentaje de las preguntas aplicables tiene una respuesta válida. |
| Coherencia financiera orientativa | Señalar combinaciones económicas que requieren aclaración, mediante un estado y sus motivos, sin porcentaje de suficiencia. |

Las secciones del inmueble y del stand publicitario, la limpieza de respuestas al dejar de aplicar, su almacenamiento y la consulta administrativa están implementados. En un stand, la pregunta del terreno o inmueble y la sección legal no aplican, porque el stand se monta en el espacio que asigna el evento. Las cuatro preguntas del stand cuentan en información completada, pero no puntúan. Su incorporación a la puntuación, una diferenciación económica por tipo de proyecto y cualquier cambio de pesos requieren aprobación posterior; no forman parte del cálculo actual.

Las métricas apoyan la revisión humana. No aprueban ni rechazan solicitudes, no deciden la reunión y una puntuación baja no impide el envío. La validación de campos obligatorios conserva sus reglas funcionales.

## 2. Principios del algoritmo

1. Partir de 100 y descontar únicamente las causas previstas en las reglas vigentes.
2. Aplicar una sola deducción por causa, utilizando el mayor valor de sus condiciones detectadas.
3. Evaluar cada pregunta únicamente cuando corresponde. Una pregunta no aplicable se identifica como N/A.
4. No otorgar puntos por mayor presupuesto o capital, propiedad del inmueble, experiencia, tamaño, calidad de lujo, cantidad de documentos o número de propietarios.
5. Distinguir información respondida de respuestas favorables: «No», «No lo sé aún» o una opción de trámite admitida pueden estar completamente respondidas.
6. Mantener independientes compatibilidad, información completada y coherencia financiera.
7. Explicar cada hallazgo con su causa, categoría, gravedad y las respuestas que lo originaron.
8. Conservar los resultados de compatibilidad de evaluaciones anteriores y la versión con la que fueron calculados.
9. Tratar documentos y fondos declarados como información del cliente, pendiente de revisión; su declaración no constituye verificación.

## 3. Preguntas y opciones del formulario

Las etiquetas y opciones siguientes reproducen el formulario vigente. «Obligatoria» se refiere a la validación de envío; una pregunta opcional puede participar en información completada cuando corresponde.

### 3.1. Detalles del proyecto

| Pregunta | Opciones o respuesta | Tratamiento |
| --- | --- | --- |
| Nombre del proyecto | Texto de 3 a 150 caracteres. | Obligatoria. Informativa; cuenta como respondida si es válida. |
| Tipo de proyecto | Residencial; Comercial; Corporativo; Stand publicitario. | Obligatoria. Sin puntos por tipo. Únicamente «Stand publicitario» activa «Requisitos del stand». |
| Ubicación del proyecto | Dirección válida de 5 a 255 caracteres. | Obligatoria. Informativa; sin puntos por ubicación. |
| Descripción del proyecto | Texto de 30 a 100 caracteres, después de retirar espacios al inicio y al final. | Obligatoria. Una descripción válida cuenta como respondida. Su longitud no suma ni resta; no se evalúa claridad mediante IA. |
| Tamaño aproximado del proyecto | Pequeño (menos de 80 m²); Mediano (80-200 m²); Grande (200-500 m²); Muy grande (más de 500 m²); No lo sé aún. | Opcional. «No lo sé aún» cuenta como respondida. «No lo sé aún» o sin responder resta solo si el tamaño es estimable (sección 5). Los tamaños definidos no reciben puntos; solo se contrastan con la inversión. |
| ¿Cómo desea desarrollar el proyecto? | Por fases; En su totalidad; Por definir. | Obligatoria. «Por definir» genera una deducción única de 10; las modalidades definidas no reciben bonificaciones. |
| ¿Tiene terreno o inmueble disponible? | Sí, disponible; En proceso de adquirirlo; No todavía. | Obligatoria, salvo en «Stand publicitario», donde es N/A y no se muestra. Controla la sección legal. No suma por disponer de inmueble; se contrasta con el inicio previsto. |

### 3.2. Requisitos del stand

Esta sección se muestra exclusivamente para **«Stand publicitario»**, según la condición del diseño. **«Stands y exhibiciones» es un tipo retirado**, conservado únicamente en registros anteriores; no se ofrece como opción ni activa esta sección. Los demás tipos son N/A.

| Pregunta | Opciones o respuesta | Tratamiento |
| --- | --- | --- |
| ¿El evento cuenta con normas o requisitos para el montaje del stand? | Sí, tengo los requisitos; Estoy gestionando los requisitos; Aún no tengo los requisitos. | Opcional. Cuenta en información completada. No disponer de requisitos no genera deducciones ni bloquea por sí solo el envío. |
| Documentación disponible | Manual del expositor; Reglamento del evento; Especificaciones técnicas del stand; Otro. | Selección múltiple opcional, habilitada con «Sí, tengo los requisitos». Solo entonces cuenta en información completada; sin selección queda incompleta. No exige adjuntar documentos. |
| ¿Ya tienes asignado el espacio dentro del evento? | Sí, ya está asignado; La asignación está en proceso; Aún no está asignado. | Obligatoria únicamente para «Stand publicitario». Las tres respuestas son válidas y cuentan como respondidas; ninguna puntúa. |
| ¿Tienes las medidas o plano del espacio asignado? | Casilla de respuesta Sí/No, con estado sin responder. | Opcional. Cuenta en información completada. Independiente de los planos del inmueble. |

Los administradores pueden consultar estas respuestas para preparar la reunión. Los documentos declarados disponibles no están automáticamente verificados. Al cambiar a otro tipo se oculta la sección y se borran sus respuestas; al volver a «Stand publicitario» se muestra vacía. No se acepta información de esta sección para otros tipos.

**Estas cuatro preguntas cuentan en información completada. No cambian la compatibilidad ni la coherencia financiera.** El espacio asignado no hereda las deducciones del inmueble.

### 3.3. Documentación legal del inmueble

La sección aparece solo cuando «¿Tiene terreno o inmueble disponible?» tiene la respuesta **«Sí, disponible»**, y nunca en «Stand publicitario».

| Pregunta | Opciones o respuesta | Tratamiento |
| --- | --- | --- |
| ¿Cuenta con documentación que acredite la situación legal del inmueble? | Sí, tengo la documentación disponible; La documentación está en trámite; No dispongo de documentación. | Obligatoria cuando aplica. En trámite: −3. No disponible: −6. Una sola deducción legal. |
| Documentación disponible | Documento de propiedad; Contrato de compra; Contrato de arrendamiento; Otro documento. | Selección múltiple obligatoria únicamente con «Sí, tengo la documentación disponible»; al menos un tipo. No suma por tipo o cantidad. |
| ¿El inmueble tiene más de un propietario? | Sí; No. | Obligatoria cuando hay inmueble disponible. Apoyo administrativo, sin puntos ni deducciones por propietarios. |
| ¿Dispone de planos del lugar? | Casilla de respuesta Sí/No, con estado sin responder. | Opcional cuando hay inmueble disponible. Desde 3.3 no resta. «No» o sin responder generan una observación para administración, sin puntos. |

La selección de documentos expresa disponibilidad declarada; no acredita su autenticidad, suficiencia ni una revisión legal concluida. Declarar disponibilidad sin seleccionar un tipo no supera la validación de envío. En un registro incompleto con esa combinación, el evaluador conserva el tratamiento defensivo de documentación no disponible; no verifica documentos.

### 3.4. Viabilidad financiera

| Pregunta | Opciones exactas | Tratamiento |
| --- | --- | --- |
| Rango de inversión estimado | No lo tengo definido aún; Menos de $10,000 USD; $10,000 - $50,000 USD; $50,000 - $150,000 USD; Más de $150,000 USD. | Obligatoria. Un rango definido nunca suma puntos por su monto. La indefinición y los cruces previstos con tamaño o calidad pueden generar deducciones. |
| Disponibilidad del capital | Disponible ahora; En los próximos 3 meses; Busca financiamiento; Indefinido. | Obligatoria. No suma por tener capital. Solo se contrasta con el plazo de inicio. |

«Disponible ahora» es una declaración del cliente, no una verificación de fondos. «Busca financiamiento» no resta por sí sola.

### 3.5. Compatibilidad

| Pregunta | Opciones exactas | Tratamiento |
| --- | --- | --- |
| ¿Cuándo espera iniciar el proyecto? | De inmediato; 1-3 meses; 3-6 meses; Más de 6 meses. | Obligatoria. Sin puntos por plazo; se contrasta con capital, inmueble e inversión definida. |
| ¿Quién toma la decisión final del proyecto? | Yo solo/a; Con mi pareja/socio; Familia extendida; Empresa/junta. | Opcional e informativa. Sin deducciones por decisor. |
| Expectativa de estilo / nivel de calidad | Funcional y económico; Calidad estándar; Premium; Exclusivo/lujo. | Opcional. No suma por calidad; solo se contrasta con la inversión en los casos previstos. |
| ¿Ha trabajado con un arquitecto o diseñador antes? | Sí, buena experiencia; Sí, mala experiencia; No, primera vez. | Opcional e informativa. La experiencia no suma ni resta. |

### 3.6. Referencias

| Campo | Respuesta | Tratamiento |
| --- | --- | --- |
| Subir imágenes / archivos (opcional) | JPEG/JPG, PNG, PDF o MP4; hasta 10 archivos de 50 MB cada uno, máximo total de 200 MB. | Opcional e informativo. Desde 3.2 no adjuntar archivos no resta; tener varios no añade puntos. No participa en información completada. |
| Link de referencia (Pinterest, web, etc.) | Enlace http o https válido de hasta 500 caracteres, opcional. | Opcional e informativo. Desde 3.2 no incluirlo no resta. No participa en información completada. |

## 4. Fórmula de compatibilidad

**Compatibilidad = 100 − suma de las deducciones únicas por causa**, con el resultado limitado entre 0 y 100.

Cuando varias condiciones corresponden a una misma causa, se utiliza **la mayor deducción**, no la suma. Causas diferentes sí pueden acumularse. Una pregunta N/A no genera ninguna deducción.

El resultado se acompaña de todos los hallazgos detectados. Sus categorías se conservan: financiera, temporal, alcance, legal e información; consistencia queda reservada para usos definidos posteriormente. La gravedad se comunica como baja, media o alta, sin crear otro porcentaje ni aplicar una segunda deducción.

## 5. Deducciones por causa

Los valores de esta tabla son los existentes en la versión implementada. Se presentan para validación de la dirección y se conservan sin modificaciones en esta actualización.

| Causa | Condición | Deducción única |
| --- | --- | ---: |
| Tamaño sin definir | «No lo sé aún» o sin respuesta, solo si el tamaño es estimable: residencial, comercial o corporativo con inmueble «Sí, disponible»; stand con espacio «Sí, ya está asignado» y medidas o plano disponibles. En los demás casos no resta. | 15 |
| Modalidad sin definir | «Por definir», también si el inicio es «De inmediato». | 10 |
| Documentación legal pendiente | Con inmueble disponible: «La documentación está en trámite». | 3 |
| Documentación legal pendiente | Con inmueble disponible: «No dispongo de documentación». | 6 |
| Inversión sin definir | «No lo tengo definido aún». | 15 |
| Inversión sin definir | Además, tamaño «Muy grande (más de 500 m²)» o calidad «Exclusivo/lujo». | 20 |
| Inversión sin definir | Además, tamaño grande o calidad Premium: 15; inicio «De inmediato»: 10; inicio «1-3 meses»: 5. | Se mantiene el máximo de la causa: 15 o 20; estos valores no se suman. |
| Desajuste entre inversión y alcance | «Menos de $10,000 USD» con «Mediano (80-200 m²)». | 10 |
| Desajuste entre inversión y alcance | «Menos de $10,000 USD» con «Grande (200-500 m²)». | 25 |
| Desajuste entre inversión y alcance | «Menos de $10,000 USD» con «Muy grande (más de 500 m²)». | 35 |
| Desajuste entre inversión y alcance | «$10,000 - $50,000 USD» con «Muy grande (más de 500 m²)». | 25 |
| Desajuste entre inversión y alcance | «Menos de $10,000 USD» con «Premium». | 20 |
| Desajuste entre inversión y alcance | «Menos de $10,000 USD» con «Exclusivo/lujo». | 30 |
| Desajuste entre inversión y alcance | «$10,000 - $50,000 USD» con «Exclusivo/lujo». | 20 |
| Capital frente al inicio | «Indefinido» y «De inmediato». | 20 |
| Capital frente al inicio | «Busca financiamiento» y «De inmediato». | 15 |
| Capital frente al inicio | «En los próximos 3 meses» y «De inmediato». | 10 |
| Capital frente al inicio | «Indefinido» y «1-3 meses». | 10 |
| Capital frente al inicio | «Busca financiamiento» y «1-3 meses». | 8 |
| Inmueble frente al inicio | «No todavía» y «De inmediato». | 20 |
| Inmueble frente al inicio | «En proceso de adquirirlo» y «De inmediato». | 10 |
| Inmueble frente al inicio | «No todavía» y «1-3 meses». | 10 |

Todas las filas de una misma causa se consolidan. Por ejemplo, muy grande y Premium con menos de $10,000 USD produce **una deducción de 35**, no 35 + 20. Documentación legal y planos son causas diferentes; sus deducciones pueden acumularse cuando ambas aplican.

**Retiradas:** «Archivos de referencia ausentes» (−5) y «Enlace de referencia ausente» (−2) en 3.2; «Planos del inmueble ausentes» (−2) en 3.3. Las evaluaciones anteriores las conservan en su resultado y sus observaciones; las solicitudes nuevas no las reciben.

Los cruces financieros indican aspectos que deben revisarse. No demuestran que el presupuesto sea insuficiente para contratar diseño o ejecutar una obra.

## 6. Condiciones especiales y preguntas N/A

- Con «En proceso de adquirirlo» o «No todavía», la situación legal, documentos, propietarios y planos del inmueble son N/A. Se ocultan y limpian sus respuestas; no se acepta información de esos campos cuando no corresponde.
- En «Stand publicitario», la pregunta del terreno o inmueble y toda la sección legal son N/A. Por eso no se aplican las deducciones legal, de planos ni de inmueble frente al inicio. Las de capital y presupuesto siguen aplicando.
- La lista de documentos legales solo aplica con inmueble disponible y «Sí, tengo la documentación disponible». Con documentación en trámite o no disponible, la lista es N/A.
- Los requisitos del stand solo aplican a «Stand publicitario». Cambiar a otro tipo limpia el bloque. «Stands y exhibiciones» se retira del catálogo vigente; las solicitudes anteriores mantienen su tipo, pueden conservarlo al editarse y no se convierten automáticamente a «Stand publicitario».
- Los planos del espacio del evento no sustituyen ni modifican la respuesta sobre planos del inmueble.
- Los plazos «3-6 meses» y «Más de 6 meses» no generan deducciones temporales con las reglas actuales.
- Las solicitudes anteriores no reciben respuestas ficticias del stand ni se reclasifican. Su compatibilidad guardada conserva puntuación, nivel, versión y observaciones originales, incluso un stand evaluado con 3.0 que recibió una deducción de inmueble. Las métricas de información completada y coherencia financiera mantienen su cálculo habitual desde las respuestas. Un stand sin la sección guardada deja sus preguntas como N/A.
- Una solicitud corregida y reenviada recibe una nueva evaluación de compatibilidad conforme a las reglas vigentes del envío.

## 7. Información completada

**Información completada = preguntas aplicables respondidas ÷ preguntas aplicables × 100**, redondeada al entero más cercano.

El catálogo vigente considera 21 preguntas posibles:

| Condición | Preguntas aplicables |
| --- | ---: |
| Sin inmueble disponible | 13 generales. |
| Inmueble disponible, documentación en trámite o no disponible | 13 generales + situación legal + propietarios + planos = 16. |
| Inmueble disponible y documentación disponible | Las anteriores + selección de documentos = 17. |
| Stand publicitario, normas en gestión, no disponibles o sin responder | 12 generales (sin la pregunta del inmueble) + normas + espacio + medidas o plano = 15. |
| Stand publicitario con «Sí, tengo los requisitos» | Las anteriores + documentación del evento = 16. |

Participan preguntas obligatorias y opcionales. Una respuesta válida como «No», «No todavía», «No lo sé aún», «Por definir», «Indefinido» o «La documentación está en trámite» cuenta como respondida. Una casilla sin respuesta sigue incompleta; una respuesta explícita «No» está respondida aunque genere una observación de compatibilidad.

Las preguntas N/A se excluyen tanto del numerador como del denominador. Los archivos, el enlace de referencia y los datos automáticos de ubicación no forman parte de este porcentaje.

Las cuatro preguntas del stand **solo aplican a «Stand publicitario»**. Los demás tipos no se consideran incompletos por esa información.

## 8. Coherencia financiera orientativa

Se contrastan rango de inversión, tamaño, calidad, modalidad de desarrollo, disponibilidad del capital y plazo. No se utilizan requisitos del stand, documentación legal, propietarios, experiencia, tipo de proyecto ni ubicación.

El formulario no especifica si el presupuesto incluye diseño, ejecución o ambos. «Por fases» o «En su totalidad» no aclara esa cobertura. Ante una combinación que requiere revisión se explica esta incertidumbre; con desarrollo por fases también se aclara que el presupuesto podría corresponder a una sola etapa.

| Estado visible | Significado |
| --- | --- |
| Sin incoherencias financieras detectadas | No hay contradicciones según las reglas disponibles. No equivale a una aprobación financiera. |
| Requiere revisión financiera | Hay una combinación que debe aclarar un administrador. Los cruces observados de presupuesto con tamaño o calidad quedan en este estado. |
| Riesgo financiero elevado | Actualmente corresponde a «Indefinido» en capital con inicio «De inmediato». No demuestra que el proyecto sea inviable. |
| Información financiera insuficiente | No se ha definido el rango de inversión o faltan tamaño comparable y calidad para contrastarlo. |
| Pendiente de reglas de evaluación | Estado reservado; las reglas configuradas actualmente no lo producen. |

Si concurren varios estados, prevalece riesgo elevado, después revisión y después información insuficiente. Las aclaraciones informativas no elevan por sí solas el estado.

Esta evaluación **no aplica puntos ni deducciones**, no produce porcentajes de suficiencia y no vuelve a descontar causas ya consideradas en compatibilidad. «Busca financiamiento» con inicio en «3-6 meses» o «Más de 6 meses» no genera una observación temporal. Capital «Indefinido» con esos plazos solo informa incertidumbre, sin asumir solvencia ni insolvencia.

## 9. Ejemplos de evaluación

Perfil común: todas las preguntas aplicables respondidas; proyecto pequeño, modalidad «En su totalidad», inmueble disponible, documentación declarada disponible con un tipo seleccionado, planos disponibles, inversión «$10,000 - $50,000 USD», capital «Disponible ahora», inicio «Más de 6 meses», calidad estándar, un archivo y un enlace válido. Cada fila cambia únicamente lo indicado.

| Caso | Cambio respecto al perfil común | Compatibilidad | Información completada | Coherencia financiera |
| --- | --- | ---: | --- | --- |
| Preparado y coherente | Ninguno. | 100 | 100 % (17/17) | Sin incoherencias financieras detectadas. |
| Descripción en los límites | 30 o 100 caracteres válidos. | 100 en ambos | 100 % (17/17) | Sin cambios. |
| Documentación en trámite | «La documentación está en trámite»; selección de documentos N/A. | 97 (−3) | 100 % (16/16) | Sin cambios. |
| Sin documentación legal | «No dispongo de documentación»; selección de documentos N/A. | 94 (−6) | 100 % (16/16) | Sin cambios. |
| Sin planos del inmueble | Respuesta explícita «No». | 100 (antes 98); observación para administración | 100 % (17/17) | Sin cambios. |
| Documentación y planos pendientes | «No dispongo de documentación» y planos «No». | 94 (−6; antes 92); observación para administración | 100 % (16/16) | Sin cambios. |
| Sin inmueble disponible | «No todavía»; sección legal N/A. | 100 | 100 % (13/13) | Sin incoherencias financieras detectadas. |
| Mayor inversión y lujo | «Más de $150,000 USD» y «Exclusivo/lujo». | 100, sin bonificación | 100 % (17/17) | Sin incoherencias financieras detectadas. |
| Financiamiento con plazo flexible | «Busca financiamiento»; inicio «3-6 meses». | 100 | 100 % (17/17) | Sin incoherencias financieras detectadas. |
| Gran alcance con inversión reducida | «Grande (200-500 m²)» y «Menos de $10,000 USD». | 75 (−25) | 100 % (17/17) | Requiere revisión financiera. |
| Dos condiciones de la misma causa | Muy grande, Premium y «Menos de $10,000 USD». | 65 (una deducción de 35) | 100 % (17/17) | Requiere revisión financiera. |
| Inversión sin definir con alcance exigente | «No lo tengo definido aún», muy grande, lujo e inicio inmediato. | 80 (una deducción de 20) | 100 % (17/17) | Información financiera insuficiente. |
| Capital indefinido e inicio inmediato | «Indefinido» y «De inmediato». | 80 (−20) | 100 % (17/17) | Riesgo financiero elevado. |
| Completamente respondido con varias causas | Inmueble en adquisición, muy grande, lujo, inversión «$10,000 - $50,000 USD», busca financiamiento e inicio inmediato. | 50 (−25 −15 −10) | 100 % (13/13) | Requiere revisión financiera. |
| Sin archivos ni enlace | Sin imágenes, archivos ni enlace. | 100 (antes 93) | 100 % (17/17) | Sin cambios. |
| Opcionales sin respuesta | Sin tamaño, decisor, calidad, experiencia, archivos ni enlace. | 85 (−15; antes 78) | 76 % (13/17) | Información financiera insuficiente. |
| Stand con requisitos | «Stand publicitario» (inmueble N/A), requisitos disponibles con documentación seleccionada, espacio asignado y medidas respondidas. | 100 | 100 % (16/16) | Sin cambios por el stand. |
| Stand sin requisitos | Igual al anterior, «Aún no tengo los requisitos» y «Aún no está asignado». | 100 | 100 % (15/15) | Sin cambios por el stand; admite envío. |
| Stand con requisitos sin documentación seleccionada | Requisitos disponibles, sin seleccionar documentación. | 100 | 94 % (15/16) | Sin cambios por el stand. |
| Stand con inicio inmediato | Stand con requisitos, inicio «De inmediato». En 3.0 podía restar 20 por «No todavía». | 100 | 100 % (16/16) | Sin cambios por el stand. |
| Stand con capital indefinido | Stand con requisitos, capital «Indefinido» e inicio «De inmediato». | 80 (−20) | 100 % (16/16) | Riesgo financiero elevado. |
| Otro tipo de proyecto | «Comercial», sin inmueble disponible; requisitos del stand N/A. | 100 | 100 % (13/13) | Sin cambios por el tipo. |

Estos ejemplos conservan los valores actuales; una clasificación favorable no sustituye el análisis de los hallazgos ni la revisión humana.

## 10. Clasificación final de compatibilidad

| Resultado | Clasificación |
| ---: | --- |
| 80–100 | Excelente compatibilidad |
| 60–79 | Buena compatibilidad |
| 40–59 | Compatibilidad media |
| 20–39 | Baja compatibilidad |
| 0–19 | Solicitud poco definida |

Los límites de clasificación se conservan. La compatibilidad no es un promedio de los otros resultados: una solicitud puede estar 100 % respondida y presentar contradicciones que reduzcan su compatibilidad.

## 11. Conclusión y solicitud de aprobación

Se solicita a la dirección revisar y aprobar esta propuesta V3 (fórmula 3.3): el cálculo por causas, los valores conservados, las clasificaciones, el catálogo de información completada y el alcance orientativo de la evaluación financiera.

La consolidación mantiene:

- la descripción como información válida sin peso por longitud;
- las deducciones legales solo donde corresponden, nunca en un stand publicitario, y los planos como observación sin puntos;
- el tamaño desconocido como deducción solo cuando el cliente puede estimarlo;
- los archivos y el enlace de referencia como material opcional que no resta;
- los requisitos del stand como apoyo administrativo, que cuentan en información completada sin efecto en compatibilidad ni en coherencia financiera.

También conserva la distinción entre documentación declarada y verificada, así como los resultados históricos.

Esta propuesta **no constituye una aprobación de reglas nuevas**. Cualquier modificación posterior de pesos, incorporación de preguntas del stand a la puntuación o evaluación económica por tipo deberá quedar expresamente aprobada, documentada, versionada y comprobada antes de aplicarse.

## 12. Cambios de la versión 3.3

**Planos del inmueble.** Ya no restan. ARCA Studio puede realizar levantamientos o elaborar los planos, por lo que su ausencia no indica falta de preparación. Con inmueble disponible, administración ve una observación sin puntos:

- con «No»: «El cliente no dispone de planos del inmueble. Durante la revisión inicial se deberá determinar si se requiere un levantamiento arquitectónico o la elaboración de planos»;
- sin respuesta: «No se ha confirmado la disponibilidad de planos del inmueble. Se recomienda aclararlo durante la revisión inicial».

El cliente no ve estas observaciones. No afectan la información completada ni la coherencia financiera.

**Tamaño del proyecto.** Conserva −15 solo cuando hay información suficiente para una estimación inicial razonable. Para un stand no basta con tener el espacio asignado: también deben estar disponibles sus medidas o plano.

| Caso con tamaño desconocido | 3.2 | 3.3 |
| --- | ---: | ---: |
| Residencial, comercial o corporativo con inmueble disponible | −15 | −15 |
| Inmueble en adquisición o «No todavía» | −15 | 0 |
| Stand con espacio asignado y medidas | −15 | −15 |
| Stand con espacio asignado sin medidas o sin responder | −15 | 0 |
| Stand con asignación en proceso o sin asignar | −15 | 0 |

**Históricos.** Las evaluaciones 3.0, 3.1 y 3.2 conservan puntuación, nivel, motivos y versión; no se recalculan.

**Pendiente para una fase posterior.** En los stands, los cruces de inversión con tamaño utilizan rangos en m² calibrados para obras; por ejemplo, un stand «Grande» con menos de USD 10.000 resta 25. No se modifica sin aprobación. Se propone definir rangos propios para stands, sin equivalencias entre m² de stands y de construcción.

El detalle técnico está en `docs/PROJECT_REQUEST_EVALUATION.md`, sección 19.
