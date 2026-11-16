# Protocolo de Eventos WebSocket (`Socket.IO`)

> **Estado:** Envelope base validado con Zod activo desde **M0** en `@truco/shared`. El catálogo completo de eventos de sala, partida y reconexión se implementa y documenta en **M2** (`STATE-02`).

## Envelope obligatorio (`WsEnvelopeSchema`)

Todo mensaje entrante y saliente cumple:

```json
{
  "eventId": "019a7e40-0000-7000-8000-000000000001",
  "seq": 1,
  "ts": 1794600000000,
  "type": "table.state",
  "payload": {}
}
```

## Garantías de protocolo

1. Handshake autenticado.
2. Orden determinista por `seq` por sala.
3. Idempotencia de comandos de cliente por `eventId`.
4. Reenvío incremental desde `lastSeq` o `game.resync` filtrado exclusivamente por `viewFor`.
5. **Prohibición absoluta** de transmitir cartas o señas privadas a asientos no autorizados.
