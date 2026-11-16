# Modelo de Amenazas y Seguridad (`THREAT_MODEL.md`)

> **Estado:** Principios rectores establecidos en **M0**. Auditoría completa STRIDE, pruebas automatizadas anti-fuga y endurecimiento final se consolidan en **M8** (`STATE-08`).

## Superficies y controles obligatorios desde el diseño

1. **Manipulación de estado de juego / revelación de cartas ajenas:**
   - Mitigación: servidor 100% autoritativo; el cliente jamás recibe `GameState`, solo `viewFor(state, seat)` y eventos proyectados con `projectEventsForSeat`; barajado CSPRNG Fisher-Yates determinista con esquema **commit-reveal** verificable al final de la partida (`SHA-256("truco-v1:" + seedReveal) === seedCommitment`).
   - **Alcance exacto y límite criptográfico del commit-reveal:**
     - **Qué garantiza:** prueba matemáticamente ante todos los participantes que el servidor fijó la semilla aleatoria _antes_ de jugar la primera carta (`game.started`) y **no alteró el orden del mazo ni las manos posteriores durante el transcurso de la partida**.
     - **Qué NO oculta por sí solo:** al tratarse de una arquitectura cliente-servidor autoritativa (y no de _mental poker_ criptográfico entre pares), **el servidor conoce la semilla y todas las manos privadas mientras la partida está en curso (`IN_GAME`)**. Por ello, la confidencialidad frente a operadores o volcados de memoria/cache se protege complementariamente cifrando la semilla en reposo en Redis con **AES-256-GCM** (`SEED_ENCRYPTION_KEY`), prohibiendo todo endpoint administrativo que exponga manos activas no jugadas y auditando accesos en `audit_logs`.
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
