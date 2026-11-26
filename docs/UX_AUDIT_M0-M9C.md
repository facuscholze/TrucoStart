# Revisión visual y oportunidades UX — M0–M9c

**Fecha:** 2026-11-19

**Alcance:** revisión visual transversal de las capturas disponibles de web y administración, con foco en 360×800 y 1200×900. Incluye inicio, acceso, lobby, sala/mesa, tutorial, anotador, perfil/ajustes, reporte, social, estadísticas/historial, ranking, progresión y panel admin. Las capturas representativas están en [`docs/screenshots/`](./screenshots/).

La revisión es heurística y estática: no sustituye pruebas moderadas con jugadores ni cubre todas las combinaciones de contenido vacío, error, zoom o dispositivo real. No se implementan las oportunidades listadas aquí ni se autoriza alcance nuevo; M0–M9c y sus pendientes siguen separados de Etapa 3.

## Resultado de las verificaciones de experiencia

- Web responsive: **80 combinaciones ruta/viewport, 0 overflow horizontal** (`audit:responsive`).
- Web accesibilidad: **0 hallazgos axe** en la auditoría WCAG 2.2 A/AA (`audit:a11y`).
- Admin: **42 combinaciones sección/viewport, 0 overflow, 0 hallazgos axe**; navegación con Tab y Enter hasta Reportes comprobada.
- Reporte: diálogo y foco de retorno comprobados; `report-flow.spec.tsx`, **9/9**. El caso de Escape volvió a pasar sin logs de diagnóstico (**1/1**).
- Rendimiento móvil frío, observado en 360×800, CPU 4×, RTT 150 ms y 1.6 Mbps de descarga (diagnóstico local, no presupuesto de CI):

  | Ruta     |     FCP |     LCP |    CLS | Tareas largas |
  | -------- | ------: | ------: | -----: | ------------: |
  | Inicio   | 2084 ms | 2084 ms | 0.0290 |    3 / 421 ms |
  | Rankings | 1260 ms | 1412 ms | 0.0041 |    3 / 320 ms |
  | Tutorial | 1236 ms | 1632 ms | 0.0078 |    2 / 240 ms |

- El desplazamiento grande del pie en Rankings se redujo: la reserva móvil de 37rem (592 px) queda próxima al contenido cargado (588 px); el pie pasó de y=575→765 px y CLS 0.0709 a y=769→765 px y CLS 0.0041. En la última corrida el residuo de 0.0038 se atribuyó al texto del párrafo de carga temporal (`p.min-h-[7rem]`), en y=590→590 px; no es otro salto del pie y queda por debajo del umbral habitual de CLS.

## Estado de implementación (2026-11-26)

Tanda de pulido UX ejecutada sobre esta lista. Estado por oportunidad:

| #   | Prioridad | Estado                                                                                                                       |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | P1        | Implementada — "Jugar ahora" es la acción principal; la práctica se ofrece al superar el umbral de espera (30 s por defecto) |
| 2   | P1        | Implementada — señal de continuidad en la barra inferior (degradado, chevron y descripción accesible)                        |
| 3   | P2        | Implementada — encabezado de escritorio en una sola fila de 61 px a 1024–1440 px                                             |
| 4   | P2        | Implementada — mesas con personas primero, práctica en bloque secundario                                                     |
| 5   | P2        | **Diferida** — criterio de medición con jugadores reales en `docs/BACKLOG.md`                                                |
| 6   | P2        | Implementada — la acción de notificación va en su propia fila, sin partirse                                                  |
| 7   | P2        | Implementada — metadatos del ranking legibles conservando los tres datos                                                     |
| 8   | P2        | **Diferida** — criterio de medición con datos de dispositivos reales en `docs/BACKLOG.md`                                    |
| 9   | P3        | Implementada — cabecera de caso fija y asas legibles sin perder el UUID íntegro                                              |

Verificación: `pnpm --filter @truco/web measure:ux` (CLS por ruta y ancho, filas de encabezado, pista de la barra), `audit:a11y` sin hallazgos axe WCAG 2.2 A/AA, `audit:responsive` sin overflow y capturas antes/después a 360 y 1200 px en `docs/screenshots/`. Decisión registrada en ADR-028.

---

## Oportunidades UX priorizadas (estado original del relevamiento)

Prioridad **P1**: afecta el inicio de la tarea o la orientación en móvil. **P2**: fricción recurrente o de lectura. **P3**: eficiencia de una tarea especializada.

1. **P1 — Hacer visible el primer paso para jugar en móvil.** En `m5b-home-360.png`, el hero ocupa casi toda la primera pantalla y “Partida rápida” queda por debajo del pliegue, cerca del menú fijo; en `m5b-lobby-360.png`, el bloque de práctica desplaza las mesas públicas, la cola y el ingreso por código. Revisar la jerarquía móvil para que la acción de juego más frecuente se descubra antes, sin quitar alternativas ni ocultar controles. **Aceptación futura:** en 360×800 el CTA principal se identifica sin explorar varias pantallas y ningún control primario queda tapado por la navegación fija.

2. **P1 — Comunicar que la navegación inferior se desplaza horizontalmente.** Tras M9a–M9c hay más destinos que los que caben en 360 px; `AppShell` conserva una barra táctil desplazable, pero las capturas `m9a-amigos-360.png` y `m9b-ranking-360.png` no hacen evidente que quedan destinos fuera de cuadro. Añadir una señal visual de continuidad o ajustar la distribución existente. **Aceptación futura:** todos los destinos son descubribles con tacto y teclado, y la sección activa sigue visible sin overflow del documento.

3. **P2 — Evitar el salto de dos filas del encabezado de escritorio.** En capturas a 1200 px de Amigos, Rankings y Progreso, la marca/navegación queda arriba y los controles de sonido/cuenta bajan a otra fila, añadiendo altura en casi todas las rutas. Ajustar la distribución o el punto de quiebre para conservar una cabecera estable. **Aceptación futura:** navegación y controles no compiten por espacio a 1200 px y no se introduce scroll horizontal.

4. **P2 — Reequilibrar el lobby entre práctica y partidas humanas.** `m5b-lobby-1200.png` deja una gran zona vacía debajo del listado público, mientras que a 360 px el panel de práctica concentra la atención antes de las mesas. Reordenar/compactar los bloques existentes según el objetivo de la ruta y aprovechar mejor el espacio ancho; no implica añadir modos. **Aceptación futura:** desde 360 px se puede localizar rápidamente mesa pública, cola o código, y en escritorio no queda una columna dominante vacía sin contenido útil.

5. **P2 — Reducir el costo de recorrer pantallas largas de cuenta y progresión.** Perfil (estadísticas, rating, historial, privacidad y seguridad), Social y Progreso se convierten en recorridos extensos a 360 px (`m9b-perfil-rating-360.png`, `m9a-amigos-360.png`, `m9c-progression-360.png`). Priorizar tareas frecuentes y resumir o agrupar secciones secundarias, conservando todas las opciones actuales. **Aceptación futura:** el usuario encuentra edición de perfil, privacidad y seguridad sin recorrer bloques ajenos; las secciones siguen siendo navegables con teclado/lector.

6. **P2 — Evitar que las acciones de notificaciones se partan en varias líneas.** En `m9a-notificaciones-360.png`, “Marcar como leída” ocupa dos o tres líneas dentro de cada tarjeta y compite con el texto del evento. Ajustar el layout existente —por ejemplo, reservar una fila de acción en móvil— sin acortar el nombre accesible. **Aceptación futura:** el texto del evento y su acción se distinguen a 320/360 px y el área táctil conserva el mínimo de 44 px.

7. **P2 — Mejorar la lectura de metadatos del ranking móvil.** La lista de `m9b-ranking-360.png` evita el recorte de la tabla y no desborda, pero las estadísticas secundarias por jugador quedan pequeñas frente al nombre y puntaje. Aumentar legibilidad o reducir datos secundarios por tarjeta, manteniendo puesto, rating y división como foco. **Aceptación futura:** se lee con claridad a 360 px y con zoom del navegador sin scroll horizontal.

8. **P2 — Acortar el tiempo hasta una primera acción útil en Inicio.** En carga fría limitada, Inicio dio FCP/LCP ≈2.08 s y tres tareas largas por 421 ms; es el peor recorrido de las tres rutas medidas. Investigar qué trabajo de sesión/contenido puede diferirse y validar primero con una medición repetible y después con datos de dispositivos reales. **Aceptación futura:** comparar tiempo hasta un CTA utilizable y evitar regresiones de LCP/CLS; no optimizar sólo el bundle total.

9. **P3 — Hacer más escaneable la revisión de casos admin.** Las vistas móviles de reporte/Fair Play apilan contexto, evidencia, replay y acciones; las partidas se identifican mediante UUID largos (`m7-panel-reporte-360.png`, `m9b-admin-fair-play-360.png`). Mejorar la jerarquía del resumen y la identificación visual de partidas para trabajo operativo; preservar los identificadores íntegros en la evidencia. **Aceptación futura:** un moderador distingue caso, evidencia y próxima acción sin perder el contexto al desplazarse; acciones sensibles conservan confirmación y auditoría.

## Gate de publicación fuera de esta lista UX

El pie de las capturas públicas aún muestra **“BORRADOR, PENDIENTE DE REVISIÓN LEGAL”**. `docs/LEGAL_CHECKLIST.md` sigue requiriendo revisión profesional de términos, privacidad, cookies y tratamiento de datos. No reemplazar el aviso por textos presentados como aprobados hasta contar con esa revisión; este documento no es asesoramiento jurídico.

La validación local no equivale a CI remoto con PostgreSQL/Redis reales. Mantener esos gates externos según `docs/STATE.md`; **no iniciar Etapa 3** antes de resolver los pendientes de M0–M9c.
