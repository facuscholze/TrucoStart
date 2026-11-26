# Backlog Priorizado por Etapas

> **Regla de alcance:** Ninguna funcionalidad de una etapa posterior se implementa hasta haber cerrado formalmente la etapa anterior según los criterios de cierre de la Sección 21 de [`docs/MASTER_PROMPT.md`](./MASTER_PROMPT.md).

---

## Etapa 1 (MVP) — Mejoras planificadas en módulos posteriores

1. **Evaluación de cartas ya jugadas en mesa en la IA heurística (`chooseBotAction`) — Objetivo: M6:**
   - Actualmente `estimateTeamStrength` en `packages/truco-engine/src/bot.ts` estima la fuerza de Truco solo a partir de `myRemainingCards`, señas del compañero y el resultado de la primera ronda, sin ponderar `currentRoundPlays` (las cartas ya bajadas a la mesa en la ronda en curso) ni el conteo de matadores ya consumidos en rondas anteriores. Por ejemplo, puede rechazar un `VALE_CUATRO` en tercera ronda aun cuando un compañero ya bajó una carta imbatible (`1-espadas`) a la mesa. Se resolverá en **M6** junto con los niveles de dificultad de práctica y el entrenador.

---

## Etapa 2 — Crecimiento (Post-MVP)

1. **Red social y presencia (`friendships`, invitaciones, desafíos) — Entregado en M9a.**
   - Solicitudes de amistad, lista de amigos con estado conectado/jugando en tiempo real, invitaciones directas a mesa, desafíos 1v1/2v2, bloqueo, privacidad configurable, notificaciones e historial/estadísticas. Ver `docs/STATE.md`.
2. **Rating competitivo Glicko-2 por modo — Entregado en M9b.**
   - Rating, desviación y volatilidad para 1v1/2v2; sólo partidas competitivas humanas persistidas; temporadas, deltas e idempotencia transaccional. Práctica y bots no puntúan.
3. **Rankings y tablas de clasificación — Entregado en M9b.**
   - Rankings global/semanal/mensual por modo, paginación, cuenta regresiva y mínimos de partidas/rivales; proyección reconstruible Redis y filtro de privacidad `statsVisibility=ALL`.
4. **Progresión y gamificación sin pay-to-win — Entregado en M9c.**
   - XP/niveles, logros, misiones diarias/semanales, notificaciones, libro mayor inmutable de `VIRTUAL_COIN` y canje de cosméticos, con idempotencia/topes y administración auditada. Sin valor económico, compras con dinero ni transferencias; práctica/bots reciben progreso reducido, sin rating ni estadísticas públicas. Rachas y pase de temporada quedan pendientes para una etapa futura.
5. **Notificaciones — Entregado en M9a.**
   - Notificaciones in-app persistidas; Web Push configurable sigue pendiente de proveedor y consentimiento.

---

## Etapa 3 — Competitividad

1. **Torneos automatizados:**
   - Formatos eliminación simple, eliminación doble y suizo; inscripción, check-in, llaves con semillas y avance automático; premios exclusivamente cosméticos o monedas virtuales.
2. **Ligas y temporadas (`seasons`):**
   - Divisiones competitivas con ascensos/descensos y cierres de temporada auditables.
3. **Truco de 6 jugadores (3v3 / pica-pica):**
   - Extensión de modos sobre el motor N-asientos ya preparado desde M1.
4. **Modo espectador con retraso:**
   - Transmisión diferida sin exposición de manos activas en tiempo real para impedir asistencia externa.
5. **Ampliar detección de colusión y anomalías más allá de M9b — Pendiente.**
   - M9b ya registra indicios de rivalidades repetidas, partidas cortas, abandonos coordinados y posible feeding en una cola de revisión humana; ampliar análisis estadístico (incluidos patrones de señas) manteniendo siempre la intervención humana antes de sancionar.

---

## Etapa 4 — Ecosistema

1. **Comunidades y equipos (`communities`, `community_members`):**
   - Clubes/peñas de truco con rankings internos y mesas de comunidad.
2. **Tienda cosmética, pase de temporada y suscripción premium:**
   - Dorsos de cartas, paños de mesa, avatares, marcos y emotes originales. **Cero ventaja competitiva.**
3. **Eventos temáticos temporales:**
   - Modos especiales parametrizados vía `RuleSet` y misiones de evento.

---

## Etapa 5 — Escalabilidad

1. **Particionado nativo de `match_events` por rango mensual** y archivado frío en almacenamiento de objetos.
2. **Despliegue multi-región del `game-server`** con enrutamiento por latencia y orquestación dedicada.
3. **Observabilidad avanzada:** perfiles continuos, SLOs multi-región y caos controlado.
