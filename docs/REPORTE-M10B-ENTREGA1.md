# Reporte de cierre — M10b, entrega 1: truco de 6 (`3v3`)

- **Rama:** `arena/af283fcb-trucostart`, desde `5e79807` (`main` con M10a cerrado).
- **SHA final:** `0bab887`.
- **CI:** run [`46016609684`](https://github.com/facuscholze/TrucoStart/actions/runs/46016609684) — **6/6 en verde** (Lint/Typecheck/Fast Tests/Build, Tournament E2E, Playwright a11y 360/1200, Engine slow, Respaldo PostgreSQL, Perímetro).
- **Alcance:** el modo `3v3` existe de punta a punta (motor, contrato, game-server, API, web, admin) como modo **social**: sin ranking, sin torneos y sin ligas, con las estadísticas del perfil registrándolo.

---

## 1. Qué se entregó, contra el pedido

| Criterio pedido                                   | Estado | Dónde                                                                  |
| ------------------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `GameMode = '1v1' \| '2v2' \| '3v3'`              | ✅     | `packages/shared/src/ws/client-events.schema.ts`, `lobby/game-mode.ts` |
| Tres equipos de dos, compañeros enfrentados       | ✅     | `teamForSeat(mode, seat) = seat % 3`; asientos `0,1,2,0,1,2`           |
| Motor con cantos entre tres equipos               | ✅     | `packages/truco-engine/src/team-responder.ts`                          |
| `3v3` social: sin ranking, sin torneos, sin ligas | ✅     | `CompetitiveModeSchema`, `TournamentMode`; ADR-033                     |
| Estadísticas del perfil con `byMode['3v3']`       | ✅     | repositorio de usuarios; `byMode` siempre con las tres claves          |
| Emparejamiento casual arma mesas de 6             | ✅     | `matchmaking.service.ts` (`seatsForMode`)                              |
| UI: mesa, lobby, inicio, perfil, práctica         | ✅     | `GameTableView`, `Table`, `TeamScoreBoard`, `PracticeSetupPanel`       |
| Sin dinero real                                   | ✅     | `scripts/check-no-real-money.mjs` en verde (513 archivos)              |

## 2. Verificación (número por número)

| Suite                     | Resultado                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------- |
| API (completa)            | **208 passed, 8 skipped**                                                              |
| `m10b-six-seat.spec.ts`   | 9/9                                                                                    |
| Paridad OpenAPI           | 3/3 (`docs/openapi.v1.json` ↔ endpoint vivo)                                           |
| `packages/shared`         | **172** (15 nuevas de geometría)                                                       |
| `apps/game-server`        | **44 passed, 3 skipped** (2 nuevas de sockets por asiento)                             |
| `packages/truco-engine`   | 54 rápidas; 7 lentas (incluye 1 000 partidas de 3 equipos)                             |
| `apps/web`                | **79** (8 nuevas de la mesa de seis)                                                   |
| `apps/admin`              | 18                                                                                     |
| Lint / typecheck / format | limpios en la raíz                                                                     |
| `build`                   | 7/7 paquetes                                                                           |
| `check-no-real-money`     | OK                                                                                     |
| axe WCAG 2.2 A/AA         | 0 hallazgos nuevos a 360 y 1200 px en las tres escenas de la mesa de 6, sin overflow   |
| E2E local (stack real)    | mesa de 6 1/1 (9,2 s), multicliente + práctica 4/4 (2,7 min), torneo 2v2 2/2 (4,7 min) |

## 3. Defectos reales que aparecieron y quedaron corregidos

Todos los encontró el propio trabajo de cierre (E2E o auditoría visual), no los tests de servicio:

1. **Un asiento con dos conexiones quedaba mudo** (game-server). El actor guardaba un solo socket
   por asiento: el segundo `join` del mismo jugador (mesa en el navegador + cliente de juego, o dos
   pestañas) reemplazaba al primero y éste dejaba de recibir eventos **sin desconectarse**. La mesa
   se le congelaba. Ahora cada asiento tiene un conjunto de sockets y sólo el último que se va
   dispara la desconexión. `tests/multi-socket-seat.spec.ts` lo fija: **los dos tests fallan contra
   el código anterior**, verificado por stash.
2. **El paño de la mesa no podía encogerse** (ui). `flex: 1 1 600px` sin `minWidth: 0`: con tres
   equipos el documento medía 385 px en una pantalla de 360. La fila de bazas tampoco envolvía las
   cartas.
3. **El tanteador de tres equipos recortaba el nombre del equipo** ("Nosotr…") en el panel angosto.
   Pasa a etiquetas cortas con el nombre completo en el `aria-label` y en el tooltip.
4. **El historial de la mesa no era enfocable con teclado** (lista con scroll propio).
5. **El cartel de fin de partida resumía tres equipos como "nosotros contra ellos"**, mostrando un
   rival arbitrario. Ahora muestra una columna por equipo.
6. **El E2E de seis no podía terminar**: cinco asientos jugaban y el sexto miraba. Ahora juegan los
   seis por WebSocket y el navegador del dueño valida lo que hay que ver.

## 4. Decisiones de contrato (ADR-033 y RULES §13)

- **Tres equipos de dos**, no seis equipos de uno ni dos de tres: mantiene la pareja del 2v2, el
  compañero enfrentado y los turnos que alternan los tres equipos.
- **`3v3` no puntúa.** El ranking, los torneos y las ligas siguen siendo de dos equipos. Pedir
  `/v1/rankings?mode=3v3` es `400`; la cola competitiva responde `400
COMPETITIVE_MODE_NOT_ALLOWED`. Las estadísticas del perfil sí lo registran.
- **Quién contesta con dos rivales:** el más cercano en orden de turnos (`NEXT_IN_TURN`, omisión) o
  el de mayor puntaje (`HIGHEST_SCORE`), configurable por `RuleSet`. Empate de envido: el equipo más
  cercano al mano.
- **Una sola fuente de geometría** (`seatsForMode`/`teamForSeat`): desaparecieron los
  `mode === '2v2' ? 4 : 2` y los `seat % 2` repartidos por API, game-server y web.

## 5. Lo que queda fuera (explícito)

- **Ligas** y espectadores: entrega 2 de M10b.
- **Torneos de seis**: el modo es social por ADR-033; los torneos siguen siendo 1v1 y 2v2.
- **Ranking/rating de `3v3`**: no hay Glicko-2 ni leaderboard del modo.
- Revisión legal: los documentos siguen siendo borradores.

## 6. Nota de proceso

Este entorno no permite descargar logs ni artefactos de GitHub Actions (los hosts de Azure Blob
están fuera del alcance de red). Por eso el paso del E2E de seis publica ahora su salida como
anotación del run en el mismo paso: la causa de un fallo queda escrita donde se puede leer sin
descargar nada. Gracias a eso se identificaron el fallo de registro asíncrono (carrera con
PostgreSQL) y el conteo de pasos.
