# Reglas Oficiales y Parametrización del Motor (`@truco/engine`)

Este documento especifica las reglas formales del Truco Argentino implementadas en `packages/truco-engine`, las decisiones adoptadas ante variantes regionales y la tabla comparativa entre los `RuleSet` iniciales (`ar-standard-v1`, `ar-sin-flor-v1` y `ar-corto-15-v1`).

---

## 1. Arquitectura General y Soporte Nativo de $N$ Asientos

- **Mazo español de 40 cartas**: 4 palos (`espadas`, `bastos`, `oros`, `copas`) con valores `1, 2, 3, 4, 5, 6, 7, 10, 11, 12` (sin `8`, `9` ni comodines).
- **$N$ asientos y $K$ equipos**: el motor soporta nativamente entre `2` y `13` asientos contiguos (`0 .. N-1`) repartidos equitativamente en $K \ge 2$ equipos intercalados (`seat % K === team`). En el MVP del lobby se habilitan mesas **1v1** (`N = 2`) y **2v2** (`N = 4`); las simulaciones verifican también **3v3** (`N = 6`).
- **Sentido de giro y mano**: el reparto y el orden de turno avanzan en sentido antihorario (`(seat + 1) % N`). En la Mano #1 es mano el asiento `0`; al iniciar cada mano siguiente, `manoSeat` rota a `(manoSeat + 1) % N`.
- **Distancia a la mano (`seatHandOrder`)**: para cualquier desempate posicional en $N$ asientos se emplea el orden relativo respecto al jugador mano de la mano actual:
  $$\text{orden}(s) = (s - \text{manoSeat} + N) \bmod N$$
  Menor valor implica mayor prioridad ("ser más mano").
- **Quién responde un canto en mesas por equipos (`responderSelectionMode`)**: cuando un asiento `callerSeat` realiza un canto de Envido, Flor o Truco en 2v2 / 3v3, el `RuleSet` define quién queda habilitado en `legalActions` (y cuyo reloj de turno corre en `activeSeat`):
  - `'NEXT_IN_TURN'` (**valor por defecto en los 3 `RuleSet` iniciales**): responde exclusivamente **el rival activo que juega a continuación en el sentido antihorario de turnos** (primer asiento activo del equipo rival recorriendo `(callerSeat + 1) % N`, `(callerSeat + 2) % N`, …; en caso de Flor, el siguiente rival portador de Flor habilitada; y ante un Envido pendiente, si el compañero del respondedor posee Flor, conserva el derecho de cantar `FLOR` para matar el Envido).
  - `'PIE_OF_TEAM'` _(configurable)_: responde exclusivamente el asiento activo más lejano a `manoSeat` (_el pie_) del equipo rival.
  - `'ANY_TEAM_MEMBER'` _(configurable)_: cualquier integrante activo del equipo rival puede emitir la respuesta.

---

## 2. Jerarquía de Cartas en el Truco

| Poder  | Carta(s)              | Nombre tradicional       |
| :----: | :-------------------- | :----------------------- |
| **14** | `1-espadas`           | Ancho de espadas (Macho) |
| **13** | `1-bastos`            | Ancho de bastos (Hembra) |
| **12** | `7-espadas`           | Siete de espadas         |
| **11** | `7-oros`              | Siete de oros            |
| **10** | `3-*` (4 palos)       | Treses                   |
| **9**  | `2-*` (4 palos)       | Doses                    |
| **8**  | `1-oros`, `1-copas`   | Anchos falsos            |
| **7**  | `12-*` (4 palos)      | Reyes                    |
| **6**  | `11-*` (4 palos)      | Caballos                 |
| **5**  | `10-*` (4 palos)      | Sotas                    |
| **4**  | `7-bastos`, `7-copas` | Sietes falsos            |
| **3**  | `6-*` (4 palos)       | Seises                   |
| **2**  | `5-*` (4 palos)       | Cincos                   |
| **1**  | `4-*` (4 palos)       | Cuatros                  |

---

## 3. Desarrollo de Rondas y Tabla Completa de Pardas

Cada mano consta de hasta **3 rondas** (_primera_, _segunda_ y _tercera_):

- En **primera ronda** sale `manoSeat`.
- Si una ronda tiene **equipo ganador único** (el máximo poder jugado pertenece exclusivamente a asientos de un único equipo), abre la ronda siguiente el **primer asiento en jugarla** dentro de esa ronda que alcanzó dicho poder máximo.
- Si dos o más equipos distintos alcanzan el mismo poder máximo en una ronda, la ronda resulta **parda** y en la ronda siguiente vuelve a salir quien abrió la ronda empardada (`roundLeadSeat`).

### Resolución de la mano según resultados de rondas

| Ronda 1      | Ronda 2      | Ronda 3         | Equipo ganador de la mano                            |
| :----------- | :----------- | :-------------- | :--------------------------------------------------- |
| Gana Eq. $A$ | Gana Eq. $A$ | _(no se juega)_ | **Equipo $A$**                                       |
| Gana Eq. $A$ | **Parda**    | _(no se juega)_ | **Equipo $A$** (_primera vale doble_)                |
| **Parda**    | Gana Eq. $X$ | _(no se juega)_ | **Equipo $X$** (_parda primera define segunda_)      |
| Gana Eq. $A$ | Gana Eq. $B$ | Gana Eq. $X$    | **Equipo $X$**                                       |
| Gana Eq. $A$ | Gana Eq. $B$ | **Parda**       | **Equipo $A$** (ganador de primera)                  |
| **Parda**    | **Parda**    | Gana Eq. $X$    | **Equipo $X$**                                       |
| **Parda**    | **Parda**    | **Parda**       | **Equipo de `manoSeat`** (triple parda gana la mano) |

---

## 4. Cálculo y Reglas de Envido

### 4.1 Puntaje de Envido de una mano de 3 cartas

Las figuras (`10, 11, 12`) aportan `0` al tanto; las cartas del `1` al `7` aportan su valor nominal:

- **2 o 3 cartas del mismo palo**: `20 + suma de las 2 mayores de ese palo` (rango `20..33`; máximo `33` con `7` y `6`).
- **3 cartas de distinto palo**: la mayor carta individual aportante (rango `0..7`).

### 4.2 Ventana y cadenas válidas

- El Envido está abierto (`envidoStatus = 'OPEN'`) **únicamente en Ronda 1** mientras no se haya cantado ni resuelto Envido ni Flor. En equipos (2v2 / 3v3), cualquier jugador en su turno durante Ronda 1 (incluido el _pie_ cuando sus compañeros ya jugaron su primera carta) puede abrir el canto.
- Progresión permitida (`maxEnvidoRepeats = 2` por defecto):
  - Inicio: `ENVIDO` (+2), `REAL_ENVIDO` (+3) o `FALTA_ENVIDO`.
  - Tras un primer `ENVIDO`: `ENVIDO` (+2, acumulando 4), `REAL_ENVIDO` (+3, acumulando 5) o `FALTA_ENVIDO`.
  - Tras `ENVIDO -> ENVIDO`: `REAL_ENVIDO` (+3, acumulando 7) o `FALTA_ENVIDO`.
  - Tras `REAL_ENVIDO`: solo `FALTA_ENVIDO`.
  - Tras `FALTA_ENVIDO`: no admite nuevas subidas; solo `QUIERO` o `NO_QUIERO`.
- **No Quiero**: otorga los puntos acumulados por los cantos previos aceptados implícitamente al subir, o `declinedBasePoints` (`1` punto) si se rechaza el primer canto de la cadena.
- **Quiero y desempate**: se compara el tanto de las 3 cartas iniciales de todos los jugadores **no idos al mazo** (`!foldedSeats`). En caso de empate numérico entre equipos, gana el asiento con menor `seatHandOrder` respecto a `manoSeat`.

### 4.3 Modos configurables de `FALTA_ENVIDO`

Controlado por `ruleset.envido.faltaEnvidoMode`:

- `'LEADER_REMAINING'` (**estándar oficial de torneos y clubes**, activo en los 3 `RuleSet` iniciales): otorga exactamente `targetScore - max(scoresByTeam)` puntos (lo que le falta al puntero para ganar el partido, con piso `1`).
- `'MALAS_MATCH_BUENAS_LEADER'` (variante tradicional de bar): si todos los equipos están en _malas_ (`maxScore < malasScoreThreshold`), otorga los puntos necesarios para ganar el partido completo (`targetScore - winnerCurrentScore`); si algún equipo entró en _buenas_, equivale a `'LEADER_REMAINING'`.

---

## 5. Orden de Cantos y _"El Envido Está Primero"_

Cuando un jugador en Ronda 1 canta el **primer `TRUCO`** sin que el Envido ni la Flor se hayan cantado aún:

1. Si algún jugador del equipo respondedor tiene **Flor habilitada**, puede cantar `FLOR`, anulando el `TRUCO` pendiente.
2. En caso contrario, si `ruleset.envido.envidoFirstMode !== 'DISABLED'`, el equipo respondedor puede anteponer cualquier canto inicial de Envido (`ENVIDO`, `REAL_ENVIDO`, `FALTA_ENVIDO`):
   - Modo `'CANCEL_TRUCO'` (**por defecto**): el canto de `TRUCO` queda anulado (`cancelledPendingTruco = true`); una vez resuelto el Envido, el turno regresa normalmente a quien tenía el turno de juego y cualquier equipo puede volver a cantar `TRUCO`.
   - Modo `'SUSPEND_TRUCO'`: el `TRUCO` queda suspendido hasta resolver el Envido y luego se reactiva automáticamente.

---

## 6. Reglas de Flor y Contraflor

Controlado por `ruleset.flor`:

- **Condición de Flor**: las **3 cartas iniciales del mismo palo**. Puntaje: `20 + suma de los 3 aportes` (rango `20..38`; máximo `38` con `7 + 6 + 5` del mismo palo).
- **Obligación implícita / pérdida por omisión**: si un jugador recibe Flor en un `RuleSet` con `flor.enabled = true` y juega su primera carta sin haberla anunciado, **pierde el derecho a cantarla o usarla durante el resto de esa mano** (`seatHoldsEnabledFlor === false`), evitando especulación ilegítima. Un jugador con Flor tampoco puede cantar Envido.
- **"La Flor mata al Envido"**: si hay un Envido pendiente y un jugador respondedor con Flor canta `FLOR`, la cadena de Envido queda anulada sin otorgar puntos de Envido y pasa a resolverse la Flor.
- **Resolución según presencia de Flor rival**:
  - **Sin Flor en el equipo rival**: se resuelve automáticamente otorgando `florPoints` (`3` pts) al equipo cantador (en 2v2/3v3, si su compañero también tiene Flor sin jugar su primera carta, se computa como flores acumuladas del equipo, `3` pts por cada flor).
  - **Con Flor en el equipo rival**: queda pendiente de respuesta del rival portador de Flor:
    - `CON_FLOR_QUIERO`: compulsa directa por `conFlorQuieroPoints` (`4` pts; desempata cercanía a `manoSeat`).
    - `ACHICO` (_Con Flor me achico_): cede sin mostrar cartas (`3` pts ante `FLOR`, o `contraflorDeclinedPoints = 4` pts ante `CONTRAFLOR` / `CONTRAFLOR_AL_RESTO`).
    - `CONTRAFLOR`: sube la apuesta a `contraflorPoints` (`6` pts) al querer (`4` pts al achicarse).
    - `CONTRAFLOR_AL_RESTO`: al querer otorga `targetScore - max(scoresByTeam)` puntos (igual criterio que Falta Envido al líder); al achicarse otorga `4` pts.

---

## 7. Truco, Retruco, Vale Cuatro y _Mano de Once_

- Escalera estricta con **alternancia obligatoria de equipos**:
  - Mano sin canto: `1` punto (`baseHandPoints`).
  - `TRUCO`: `2` pts al querer / `1` pt al no querer.
  - `RETRUCO`: `3` pts al querer / `2` pts al no querer (solo puede cantarlo el equipo que aceptó o está respondiendo `TRUCO`).
  - `VALE_CUATRO`: `4` pts al querer / `3` pts al no querer (solo puede cantarlo el equipo que aceptó o está respondiendo `RETRUCO`).
- **Subida directa en respuesta**: ante un `TRUCO` pendiente, el equipo respondedor puede responder directamente `CALL_TRUCO('RETRUCO')` (lo cual implica aceptar el `TRUCO` y revirar `RETRUCO` en un solo paso atómico, emitiendo `TRUCO_ACCEPTED` seguido de `TRUCO_CALLED`). Análogamente con `VALE_CUATRO` ante `RETRUCO`.
- **Mano de Once / Mano de Quince menos uno (`ruleset.manoDeOnce`)**:
  - En los `RuleSet` competitivos estándar (`ar-standard-v1`, `ar-sin-flor-v1`, `ar-corto-15-v1`), `manoDeOnce.enabled = false` (libertad plena de canto en todo marcador).
  - Cuando una sala privada o torneo activa `manoDeOnce: { enabled: true, forbidTrucoByLeadingTeamAtMinusOne: true }`, el equipo que se encuentra a exactamente `1` punto de ganar (`score === targetScore - 1`) tiene prohibido iniciar `TRUCO` (`legalActions` lo omite y `applyAction` devuelve `TRUCO_NOT_ALLOWED`).

---

## 8. Irse al Mazo (`FOLD_HAND`)

- Un jugador en su turno (sin cantos pendientes) puede ejecutar `FOLD_HAND`.
- **En 2v2 / 3v3 (abandono parcial)**: si el equipo aún conserva al menos un compañero activo en la mano, el asiento pasa a `foldedSeats`, deja de participar en las rondas restantes de esa mano y el turno avanza al siguiente asiento activo.
- **Abandono total de equipo**: cuando todos los integrantes de un equipo se van al mazo y queda un único equipo activo:
  - **Puntos de la mano**: si en Ronda 1 aún no se resolvió ningún canto ni ningún jugador del equipo ganador llegó a jugar carta y el Truco no fue querido, la mano otorga `1` punto (o `2` si en Ronda 1 sin envido/flor resuelto aún nadie jugó carta y aplica mazo temprano según estado del Truco; en general otorga `hand.truco.currentPoints`, que inicia en `1`).
  - **Envido pendiente al irse al mazo (`pendingEnvidoOnFold`)**: si existiera un Envido pendiente y la acción resuelve la salida a mazo, `'AWARD_DECLINED_POINTS'` acredita primero los puntos de No Quiero del Envido antes de cerrar la mano; `'CANCEL'` lo descarta sin puntos.

---

## 9. Señas en Equipos y Garantía de Privacidad (`viewFor`)

- Disponibles únicamente cuando `ruleset.signals.enabled === true` y el jugador tiene al menos un compañero activo (`hasActiveTeammate`).
- Límite estricto por mano y jugador: `maxSignalsPerHandPerPlayer = 3` (acota matemáticamente la longitud de cualquier mano e impide spam).
- Catálogo oficial de 10 señas (`packages/truco-engine/src/data/signals.json`):
  `guino_ojo` (1 de espadas), `cejas_arriba` (1 de bastos), `muesca_derecha` (7 de espadas), `muesca_izquierda` (7 de oros), `morder_labio` (3), `boca_abierta` (2), `beso` (1 falso), `cerrar_ojos` (ciego/sin juego), `inclinacion_cabeza` (tanto alto para el envido), `encoger_hombros` (juego mediano).
- **Privacidad garantizada por construcción**:
  - `viewFor(state, seat)` incluye en `visibleSignals` **únicamente** las señas cuyo `team === myTeam`, y en `myInitialCards` / `myRemainingCards` **únicamente** las cartas propias de `seat` (ni siquiera las del compañero).
  - `projectEventsForSeat(events, seats, viewerSeat)` filtra todo `SIGNAL_SENT` de equipos rivales antes de despachar eventos por WebSocket.

---

## 10. Acciones de Sistema (`SYSTEM_TIMEOUT`, Prevención de Demora y `SYSTEM_ABANDON`)

Emitidas exclusivamente por el servidor autoritativo (`apps/game-server`), nunca por clientes:

- **Temporizador de turno y aviso previo:** cada turno activo dispone de `TURN_TIMEOUT_MS` (`30 s` por defecto). Al cumplirse el 70 % de la ventana el servidor emite `game.turn` con `isWarning: true`; al alcanzar `deadline` sin acción válida del jugador activo, dispara `SYSTEM_TIMEOUT`.
- **Resolución determinista de `SYSTEM_TIMEOUT` según fase de la mano:**
  1. **Flor pendiente (`florStatus === 'PENDING'`):** responde automáticamente `RESPOND_FLOR('ACHICO')`, otorgando los puntos de Flor no aceptada al equipo cantador y reanudando el juego.
  2. **Envido pendiente (`envidoStatus === 'PENDING'`):** responde automáticamente `RESPOND_ENVIDO('NO_QUIERO')`, otorgando los puntos acumulados previos al rechazo y reanudando el juego.
  3. **Truco pendiente (`truco.pending !== null`):** responde automáticamente `RESPOND_TRUCO('NO_QUIERO')`, cerrando la mano a favor del equipo cantador por el puntaje vigente previo a la subida.
  4. **Turno normal de carta (`seat === hand.turnSeat`):** aplica `ruleset.system.timeoutOnTurn`:
     - `'FOLD_HAND'` (por defecto en los tres `RuleSet` oficiales): el jugador se va al mazo (`PLAYER_FOLDED`). En `1v1` esto cierra inmediatamente la mano a favor del rival; en `2v2` su compañero continúa jugando solo la mano si sigue activo, o termina la mano si ambos asientos del equipo se retiraron.
     - `'PLAY_LOWEST_CARD'`: juega automáticamente la carta restante de menor jerarquía de Truco (`getTrucoPower`).
- **Prevención de alargamiento abusivo por timeouts repetidos (`maxConsecutiveTimeoutsBeforeAbandon`):**
  - Para impedir que un jugador conectado pero inactivo (_AFK_ o _griefing_) estire una partida a 15 o 30 puntos dejando vencer `30 s` mano tras mano sin desconectarse, `GameState` lleva el contador `consecutiveTimeoutsBySeat[seat]`.
  - Cada `SYSTEM_TIMEOUT` incrementa `consecutiveTimeoutsBySeat[seat]` en `1`.
  - Cualquier acción voluntaria válida del jugador (`PLAY_CARD`, `CALL_*`, `RESPOND_*`, `FOLD_HAND`, `SEND_SIGNAL`) restablece `consecutiveTimeoutsBySeat[seat] = 0`.
  - Al alcanzar `ruleset.system.maxConsecutiveTimeoutsBeforeAbandon` (**`3` timeouts consecutivos** por defecto), el motor escala automáticamente el vencimiento a `SYSTEM_ABANDON` (`SYSTEM_ACTION_APPLIED` con `resolvedAs: 'ESCALATED_TO_ABANDON'`), dando por perdida la partida completa (`FORFEIT_MATCH`, `reason: 'ABANDON'`) a favor del equipo rival.
- **`SYSTEM_ABANDON` por desconexión o salida:** tras agotarse la ventana de reconexión (`RECONNECT_GRACE_MS = 45 s`) del jugador desconectado o al abandonar voluntariamente una sala en juego (`table.leave`), adjudica inmediatamente la partida al equipo rival (`reason: 'ABANDON'`) completando su puntaje hasta `targetScore`.

---

## 11. Tabla Comparativa de los `RuleSet` Iniciales

| Parámetro                                             |       `ar-standard-v1`       |     `ar-sin-flor-v1`      |     `ar-corto-15-v1`      |
| :---------------------------------------------------- | :--------------------------: | :-----------------------: | :-----------------------: |
| **Nombre**                                            |  Estándar (a 30, con Flor)   |      Sin Flor (a 30)      |  Corto (a 15, sin Flor)   |
| **`targetScore`**                                     |            **30**            |          **30**           |          **15**           |
| **`malasScoreThreshold`**                             |            **15**            |          **15**           |   **0** _(todo buenas)_   |
| **Respondedor (`responderSelectionMode`)**            |        `NEXT_IN_TURN`        |      `NEXT_IN_TURN`       |      `NEXT_IN_TURN`       |
| **Flor habilitada (`flor.enabled`)**                  | **Sí** (`3 / 4 / 6 / Resto`) |          **No**           |          **No**           |
| **Falta Envido (`faltaEnvidoMode`)**                  |      `LEADER_REMAINING`      |    `LEADER_REMAINING`     |    `LEADER_REMAINING`     |
| **"El envido está primero"**                          |        `CANCEL_TRUCO`        |      `CANCEL_TRUCO`       |      `CANCEL_TRUCO`       |
| **Mazo con envido pendiente**                         |   `AWARD_DECLINED_POINTS`    |  `AWARD_DECLINED_POINTS`  |  `AWARD_DECLINED_POINTS`  |
| **Mano de Once (`manoDeOnce.enabled`)**               |   `false` _(configurable)_   | `false` _(configurable)_  | `false` _(configurable)_  |
| **Señas en equipos (`signals.enabled`)**              |  **Sí** (máx. 3/mano/jug.)   | **Sí** (máx. 3/mano/jug.) | **Sí** (máx. 3/mano/jug.) |
| **Timeout en turno (`timeoutOnTurn`)**                |         `FOLD_HAND`          |        `FOLD_HAND`        |        `FOLD_HAND`        |
| **Máx. timeouts seguidos (`maxConsecutiveTimeouts`)** |            **3**             |           **3**           |           **3**           |

---

## 12. Torneos con Equipos (2v2)

Reglas del torneo por equipos. Son las que aplica `apps/api/src/modules/tournaments/tournament-teams.ts`
(reglas puras) y las que verifica `apps/api/src/modules/tournaments/tests/`.

### 12.1 Un equipo, un lado del cuadro

- La unidad que ocupa un lado del cuadro es el **equipo**, no la persona: son los campos
  `home_team_id` / `away_team_id` del cruce, y `home_user_id` / `away_user_id` quedan nulos
  en un torneo 2v2. Un torneo de cuatro equipos tiene **tres cruces** (dos semifinales y la
  final), no siete.
- El **cupo del torneo cuenta equipos**. Cuatro equipos de dos personas sobre un cupo de 4
  muestran `4/4`, nunca `8/4`, y el torneo se cierra cuando se inscribieron los cuatro.
- Inscripción: `POST /v1/tournaments/:id/teams` con `{ name, teammateUserIds: [una persona] }`.
  El capitán anota a los dos juntos: o queda el equipo completo o no queda nadie. Un jugador
  no puede estar en dos equipos del mismo torneo (`409`).
- **Sembrado**: por equipo, con el **rating medio** de sus integrantes.
- Mesa del cruce: **cuatro asientos intercalados** (`team 0 → asientos 0 y 2`,
  `team 1 → asientos 1 y 3`), que es el mismo reparto que usa el motor (`seat % 2 === team`).
  Es una sala privada, sin bots y sin impacto en el ranking (`is_competitive = false`).

### 12.2 Ausencias en el check-in

- Un equipo entra al cuadro **sólo si se presentaron sus dos integrantes**. El capitán solo
  no completa una mesa de cuatro asientos.
- El equipo incompleto queda **fuera entero**: sus dos integrantes pasan a `NO_SHOW` —también
  el que sí se presentó—, el equipo no ocupa ningún lado del cuadro y **no gana por
  walkover**. Regalar el cruce sería premiar a quien no completó su equipo.
- Si ningún lado de un cruce se presenta, el cruce se cierra por incomparecencia **sin
  ganador** (`FORFEITED` / `NO_SHOW`) y el torneo termina sin pagar premio de campeón.

### 12.3 Abandono durante la partida

Dos casos distintos, y la diferencia importa:

- **Irse al mazo (`FOLD_HAND`) es por mano**: el asiento sale de la mano en curso, su
  compañero sigue jugando solo si está activo y el equipo puede ganar la partida igual
  (§ 8).
- **Abandonar la partida** (`SYSTEM_ABANDON`: salir de la mesa en juego o agotar la ventana
  de reconexión) es de la **partida entera**: el equipo rival gana `targetScore - score`
  puntos hasta el objetivo y el cruce se cierra a su favor, aunque el compañero del que se
  fue siga sentado en la mesa (§ 10).
- Consecuencia en el torneo: el cruce se cierra para el **equipo** rival, el equipo que
  abandonó queda `ELIMINATED`, sus integrantes no avanzan y la tabla lo marca
  `Cayó en la ronda N`. La llave avanza sin esperar al compañero que quedó.

### 12.4 Tabla y premios

- La tabla de un torneo por equipos tiene **una fila por equipo**: `nickname` es el nombre
  del equipo y la nota de desempate dice quienes lo jugaron (`Campeón — A y B`).
- El campeón son **todas las personas del equipo**: cada integrante queda `WINNER` y cobra
  su premio por el libro mayor (una fila de `tournament_awards` por persona, con
  `team_id`), con el único `(torneo, posición, persona)` que hace idempotente el reintento.

---
