# Modelo de Amenazas y Seguridad (`THREAT_MODEL.md`)

> **Estado:** Principios rectores establecidos en **M0**. Auditoría completa STRIDE, pruebas automatizadas anti-fuga y endurecimiento final se consolidan en **M8** (`STATE-08`).

## Superficies y controles obligatorios desde el diseño

1. **Manipulación de estado de juego / revelación de cartas ajenas:**
   - Mitigación: servidor 100% autoritativo; el cliente jamás recibe `GameState`, solo `viewFor(state, seat)`; barajado CSPRNG Fisher-Yates con esquema commit-reveal verificable al final de la partida.
2. **Inyección y payloads malformados (HTTP / WS):**
   - Mitigación: esquemas estrictos Zod en `@truco/shared` rechazando propiedades o tipos inesperados.
3. **Robo de sesión y fuerza bruta:**
   - Mitigación: cookies `HttpOnly; Secure; SameSite`, rotación de refresh tokens con detección de reutilización, contraseñas con Argon2id, bloqueo progresivo y 2FA obligatorio en administración.
4. **Abuso de recursos / DoS aplicativo:**
   - Mitigación: rate limiting diferenciado por IP, cuenta y tipo de evento WS (cantos, chat rápido, creación de mesas).
5. **Economía sin riesgo monetario:**
   - Mitigación por diseño: cero dinero real, cero retiros y cero transferencias entre jugadores.
6. **Datos personales y cumplimiento legal (`STATE-09`):**
   - Minimización de datos personales y revisión jurídica pendiente conforme a la **Ley 25.326** de la República Argentina.
