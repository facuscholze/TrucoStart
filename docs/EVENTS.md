# Protocolo de Eventos WebSocket (`Socket.IO`) — `@truco/game-server`

> **Estado:** Implementado y verificado en **M2** (`@truco/shared` + `@truco/game-server`).

## 1. Transporte y Autenticación de Handshake

- **Canal único Socket.IO:** evento de transporte `"envelope"` en ambos sentidos (`client -> server` y `server -> client`).
- **Autenticación obligatoria en middleware (`io.use`):**
  - El cliente envía un ticket firmado HMAC-SHA256 (`WsAuthTicketClaims`) en `socket.handshake.auth.token` o cookie HttpOnly `truco_ws_ticket`.
  - Estructura firmada (`verifyWsAuthTicket(token, SESSION_SECRET)`):
    ```json
    {
      "userId": "u-2v2-facu",
      "sessionId": "sess-2v2-facu-000",
      "nickname": "Facu",
      "isGuest": false,
      "exp": 1794603600000
    }
    ```
  - Si falta el token, la firma no coincide o `exp <= now`, el handshake se rechaza con `Error("UNAUTHORIZED")` antes de abrir la sesión WS.

---

## 2. Envelope Obligatorio (`WsEnvelopeSchema`)

Todo mensaje entrante y saliente se valida con Zod contra `WsEnvelopeSchema`:

```json
{
  "eventId": "019a7e40-0000-7000-8000-000000000001",
  "seq": 14,
  "ts": 1794600000000,
  "type": "game.cardPlayed",
  "payload": {}
}
```

- `eventId`: identificador único (`8..128` caracteres) usado para **idempotencia** en comandos de cliente (un `eventId` ya procesado por la sala se ignora sin duplicar efectos) y trazabilidad en errores (`refEventId`).
- `seq`: entero monótono creciente asignado por `RoomActor` para todos los eventos persistidos de una sala (`1, 2, 3, ...`).
- `ts`: marca de tiempo Unix en milisegundos.
- `type`: nombre tipado del evento (`ClientEventType` o `ServerEventType`).
- `payload`: objeto validado estrictamente contra el esquema Zod específico del `type`.

---

## 3. Rate Limiting por Conexión y Categoría (`WsConnectionRateLimiter`)

Cada socket autenticado posee ventanas deslizantes independientes (`windowMs` por defecto `10_000 ms`):

| Categoría      | Eventos incluidos                                                            | Límite por ventana (por defecto)  | Variable de entorno          |
| -------------- | ---------------------------------------------------------------------------- | --------------------------------- | ---------------------------- |
| `action`       | `game.playCard`, `game.call`, `game.respond`, `game.foldHand`, `game.signal` | `30`                              | `RATE_LIMIT_WS_ACTION_MAX`   |
| `chat`         | `chat.quick`                                                                 | `8`                               | `RATE_LIMIT_WS_CHAT_MAX`     |
| `table`        | `table.join`, `table.leave`, `table.ready`, `game.rejoin`                    | `15`                              | `DEFAULT_WS_TABLE_EVENT_MAX` |
| Total conexión | Suma de todas las categorías                                                 | `max(action + chat + table, ...)` | —                            |

Cuando se supera cualquier límite, el servidor responde `type: "error"` con `code: "RATE_LIMITED"` sin invocar al `RoomActor`.

---

## 4. Eventos Cliente → Servidor (`ClientMessageSchema`)

### `table.join`

Une al usuario autenticado a una sala (o la inicializa si es el primer ocupante). Verifica que el usuario no tenga otra sala activa (`CONFLICT` en caso contrario).

```json
{
  "roomId": "mesa-2v2-amigos",
  "mode": "2v2",
  "rulesetCode": "ar-corto-15-v1",
  "turnTimeoutMs": 30000,
  "preferredSeat": 0
}
```

### `table.leave`

Retira al jugador de la sala. Si la sala está `WAITING`, libera el asiento; si está `IN_GAME`, aplica abandono inmediato (`SYSTEM_ABANDON`) otorgando la partida al equipo rival.

```json
{ "roomId": "mesa-2v2-amigos" }
```

### `table.ready`

Marca o desmarca el estado de listo (`ready`) del asiento. Cuando **todos** los asientos requeridos (`2` en `1v1`, `4` en `2v2`) están ocupados y con `ready: true`, la sala transiciona atómicamente a `IN_GAME`, genera la semilla CSPRNG y emite `table.state`, `game.started`, `game.dealt` y `game.turn`.

```json
{ "roomId": "mesa-2v2-amigos", "ready": true }
```

### `game.playCard`

Juega una carta de la mano propia identificada por `CardId` (`"${rank}-${suit}"`).

```json
{ "roomId": "mesa-2v2-amigos", "cardId": "1-espadas" }
```

### `game.call`

Realiza un canto de Envido (`ENVIDO`, `REAL_ENVIDO`, `FALTA_ENVIDO`), Flor (`FLOR`, `CONTRAFLOR`, `CONTRAFLOR_AL_RESTO`) o Truco (`TRUCO`, `RETRUCO`, `VALE_CUATRO`).

```json
{ "roomId": "mesa-2v2-amigos", "type": "ENVIDO" }
```

### `game.respond`

Responde a un canto pendiente (`QUIERO`, `NO_QUIERO`, `SUBIR`, `CON_FLOR_QUIERO`, `ACHICO`). En 2v2 por defecto (`responderSelectionMode: "NEXT_IN_TURN"`), solo el rival que juega inmediatamente después en el orden de turno está habilitado para responder.

```json
{
  "roomId": "mesa-2v2-amigos",
  "call": "TRUCO",
  "answer": "SUBIR",
  "raiseTo": "RETRUCO"
}
```

### `game.foldHand`

El jugador en turno se va al mazo (`FOLD_HAND`).

```json
{ "roomId": "mesa-2v2-amigos" }
```

### `game.signal`

Envía una seña del catálogo oficial (`signals.json`, p. ej. `guino_ojo`, `cejas_arriba`, `morder_labio`) visible **únicamente** para su propio equipo.

```json
{ "roomId": "mesa-2v2-amigos", "signalId": "guino_ojo" }
```

### `chat.quick`

Envía una frase rápida predefinida del catálogo rioplatense (`QUICK_CHAT_PHRASES`, p. ej. `buenas`, `quiero_vale_cuatro`, `bien_jugado`). No existe texto libre en MVP para prevenir abuso.

```json
{ "roomId": "mesa-2v2-amigos", "phraseId": "buenas" }
```

### `game.rejoin`

Reconecta a un jugador desconectado validando su `sessionId` y sincronizando desde `lastSeq`.

```json
{
  "roomId": "mesa-2v2-amigos",
  "sessionId": "sess-2v2-nico-002",
  "lastSeq": 12
}
```

---

## 5. Eventos Servidor → Cliente (`ServerEnvelopeSchema`) y Audiencia

Cada evento persistido incluye una audiencia estricta (`ALL`, `SEAT(i)` o `TEAM(t)`). **Jamás** se transmite `GameState` crudo ni `internalPrngState`: toda vista proviene de `viewFor(state, seat)` y las señas pasan por `projectEventsForSeat`.

| Evento                | Audiencia                  | Descripción y campos clave                                                                                                                                                                        |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `table.state`         | `ALL`                      | Estado público de sala (`WAITING` / `IN_GAME` / `FINISHED`), `mode`, `rulesetCode`, `turnTimeoutMs`, asientos (`seat`, `team`, `userId`, `nickname`, `ready`, `connected`) y `matchId`.           |
| `game.started`        | `ALL`                      | Inicio de partida: `matchId`, `rulesetCode`, `targetScore`, `seats` y compromiso criptográfico `seedCommitment` (`SHA-256` hex de 64 chars). **No** incluye `seedReveal`.                         |
| `game.dealt`          | `SEAT(i)`                  | Reparto privado al inicio de cada mano: `handNumber`, `manoSeat`, `mySeat`, `myCards` (solo las 3 cartas de `i`) y `view: viewFor(state, i)`.                                                     |
| `game.turn`           | `SEAT(i)` / `ALL`          | Cambio de turno activo (`seat`, `responderTeam`, `deadline`, `warningAt`, `view: viewFor(state, i)`). Cuando resta ~30 % del tiempo se emite aviso previo (`isWarning: true`, audiencia `ALL`).   |
| `game.cardPlayed`     | `ALL`                      | Carta jugada en la mesa (`handNumber`, `roundIndex`, `seat`, `team`, `card`) y `roundEnded` opcional (`winnerTeam`, `winningSeat`, `isParda`).                                                    |
| `game.callMade`       | `ALL`                      | Canto anunciado (`family`: `ENVIDO` \| `FLOR` \| `TRUCO`, `bid`, `seat`, `team`, `cancelledPendingTruco`).                                                                                        |
| `game.callResolved`   | `ALL`                      | Resolución de canto (`family`, `accepted`, `winningTeam`, `winningSeat`, `winningScore`, `pointsAwarded`, `responderSeat`).                                                                       |
| `game.signalSent`     | `SEAT(i)` del mismo `team` | Seña de equipo (`handNumber`, `seat`, `team`, `signalId`). Verificada con `projectEventsForSeat`; **jamás** se envía ni se reenvía en replay al equipo rival.                                     |
| `game.scoreUpdated`   | `ALL`                      | Actualización del marcador (`team`, `delta`, `newScore`, `reason`).                                                                                                                               |
| `game.handEnded`      | `ALL`                      | Cierre de mano (`handNumber`, `winnerTeam`, `pointsAwarded`, `reason`).                                                                                                                           |
| `game.ended`          | `ALL`                      | Fin de partida (`matchId`, `winnerTeam`, `scoresByTeam`, `reason`, `seedCommitment` y revelación `seedReveal`).                                                                                   |
| `game.resync`         | `SEAT(i)` (directo)        | Sincronización completa al reconectar con `lastSeq = 0` o fuera de ventana (`matchId`, `seedCommitment`, `turnDeadline`, `view: viewFor(state, i)`).                                              |
| `player.disconnected` | `ALL`                      | Notifica desconexión de un asiento durante `IN_GAME` e informa `graceDeadline` (`now + RECONNECT_GRACE_MS`, 45 s por defecto).                                                                    |
| `player.reconnected`  | `ALL`                      | Confirma que el asiento reconectó dentro de la ventana de gracia y cancela su temporizador de abandono.                                                                                           |
| `chat.quickMessage`   | `ALL`                      | Mensaje rápido validado (`seat`, `nickname`, `phraseId`, `text`).                                                                                                                                 |
| `error`               | Socket emisor              | Error estructurado (`code`: `UNAUTHORIZED` \| `FORBIDDEN` \| `VALIDATION_ERROR` \| `RULE_VIOLATION` \| `INVALID_STATE` \| `ROOM_FULL` \| `CONFLICT` \| `RATE_LIMITED`, `message`, `refEventId?`). |

---

## 6. Temporizadores, Reconexión y Recuperación ante Crash

1. **Temporizador de turno (`TURN_TIMEOUT_MS`, 30 s por defecto):**
   - Al 70 % del tiempo transcurrido emite `game.turn` con `isWarning: true`.
   - Al vencer `deadline`, ejecuta `SYSTEM_TIMEOUT` en el motor (`FOLD_HAND` o `PLAY_LOWEST_CARD` según `RuleSet.system.timeoutOnTurn`).
2. **Desconexión y ventana de gracia (`RECONNECT_GRACE_MS`, 45 s por defecto):**
   - Al desconectarse un socket durante `IN_GAME`, la sala emite `player.disconnected` con `graceDeadline` y agenda un temporizador de gracia.
   - Si el jugador envía `game.rejoin` con el `sessionId` original antes de `graceDeadline`:
     - Si `lastSeq > 0` y existen eventos en el log (`loadRoomEventsAfter(roomId, lastSeq)`), el servidor filtra únicamente los eventos cuya `EventAudience` sea visible para su asiento/equipo y los reproduce en orden de `seq`.
     - Si `lastSeq === 0` (p. ej. recarga completa de pestaña), envía `game.resync` con `viewFor(state, seat)`.
     - Cancela el temporizador de gracia y difunde `player.reconnected`.
   - Si vence `graceDeadline` sin reconexión, aplica `SYSTEM_ABANDON`, adjudica la partida al equipo rival y libera los bloqueos de sala activa.
3. **Persistencia tras cada acción y recuperación tras caída del proceso:**
   - Antes de emitir sobres por socket, `RoomActor` ejecuta `store.saveRoomStateAndEvents(snapshot, events)` guardando la semilla cifrada con **AES-256-GCM** (`encryptedSeed`).
   - Si el proceso cae abruptamente, al expirar el lease (`claimRoomOwner`) cualquier instancia saludable de `game-server` recupera `RoomActor.recoverFromSnapshot`, descifra la semilla en memoria, rearma temporizadores y atiende `game.rejoin` sin perder la mano en curso.

---

## 7. Verificación Pública de Commit-Reveal (Fair Play)

Cualquier cliente o auditor externo puede verificar al finalizar la partida (`game.ended`):

1. **Integridad del compromiso:**
   $$\operatorname{SHA-256}(\text{"truco-v1:"} \parallel \text{seedReveal}) \stackrel{?}{=} \text{seedCommitment}$$
2. **Reproducibilidad determinista del mazo:**
   Inicializando `createRngFromSeedHex(seedReveal)` (`HMAC-SHA256` en modo contador big-endian de 64 bits proyectado a precisión IEEE-754 de 53 bits) y llamando a `createGame(ruleset, seats, rng)`, se obtiene exactamente el mismo reparto inicial de cartas de la partida.

---

## 8. Namespace WebSocket de Lobby (`/lobby` en `apps/api`) — Módulo M4

El tráfico en tiempo real del lobby corre en un namespace Socket.IO **estrictamente separado** (`/lobby`, servido por `apps/api`) respecto del servidor de partidas (`apps/game-server`):

- **Autenticación de handshake:** acepta `auth.token` (ticket efímero single-use emitido por `POST /v1/auth/ws-ticket` con verificación de `jti` único) o cookie `truco_access` válida. Conexiones anónimas o al namespace raíz `/` de `apps/api` son rechazadas (`UNAUTHORIZED` / `NAMESPACE_FORBIDDEN`).
- **Garantía de cero filtraciones:** todos los broadcasts públicos pasan por `PublicLobbyTableSummarySchema` (`.strict()`). **Jamás** se emite evento alguno sobre mesas `PRIVATE` ni campos privados del jugador (`userId`, `ownerId`, `email`, `sessionId`, `joinCode`, `inviteToken`).

| Evento Servidor → Cliente | Destinatario                                        | Payload ejemplar                                                                                                                                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lobby.snapshot`          | Socket recién conectado                             | `{ "tables": [ /* PublicLobbyTableSummary[] */ ] }`                                                                                                                                                                                                                                              |
| `lobby.tableUpsert`       | Todos en `/lobby` (solo mesas `PUBLIC`)             | `{ "table": { "id": "019a8d80-...", "mode": "2v2", "rulesetCode": "ar-sin-flor-v1", "targetScore": 30, "flor": false, "turnTimeoutMs": 25000, "status": "WAITING", "ownerNickname": "ManoBrava", "occupiedSeats": 2, "maxSeats": 4, "seats": [...], "createdAt": "2026-11-13T16:12:00.000Z" } }` |
| `lobby.tableRemoved`      | Todos en `/lobby` (solo mesas `PUBLIC`)             | `{ "tableId": "019a8d80-..." }`                                                                                                                                                                                                                                                                  |
| `matchmaking.matched`     | Sala privada `user:<userId>` del jugador emparejado | `{ "tableId": "019a8d85-...", "roomId": "019a8d85-...", "mode": "1v1", "rulesetCode": "ar-standard-v1", "seat": 0, "team": 0 }`                                                                                                                                                                  |

---

## 9. Eventos Asíncronos de Ciclo de Vida (`apps/game-server -> BullMQ -> apps/api`)

`apps/game-server` **nunca escribe en PostgreSQL** (`ADR-017`). Publica eventos validados con `MatchLifecycleEventSchema` en la cola BullMQ `truco-match-lifecycle` consumidos por `MatchPersistenceService` en `apps/api`:

1. `match.started`: marca `tables.status = 'IN_GAME'` y actualiza `/lobby` si la mesa es pública.
2. `table.seatVacated`: libera asiento inactivo en `WAITING` (transfiriendo propiedad o cerrando mesa huérfana).
3. `match.completed`: ejecuta una **única transacción PostgreSQL** idempotente por `matchId` que inserta `matches`, `match_players` y `match_events`, marca `tables.status = 'FINISHED'` y desactiva `table_seats.is_active` para liberar a todos los participantes.
