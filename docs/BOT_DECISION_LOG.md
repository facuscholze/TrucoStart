# Log de decisiones — bot difícil vs bot difícil (M6)

Partida 1v1 completa simulada con `simulateMatch` (semilla `20260101`, `AR_STANDARD_V1`), con el bot **difícil** en el equipo 0. En cada turno el bot recibe únicamente su `PlayerView` (su mano, cartas ya jugadas, marcador y cantos), y las decisiones se toman con los parámetros `BOT_DIFFICULTY_PARAMS.HARD`.

## Resultado

- Ganador: **equipo 0** en 26 manos y 152 acciones.
- Marcador final: **30 - 22**.
- Decisiones registradas del bot difícil: **76** (cantos: 34, truco: 10, envido: 9).

## Parámetros usados

| Parámetro | Valor |
| --- | --- |
| `difficulty` | `HARD` |
| `envidoCallThreshold` | `25` |
| `envidoRaiseThreshold` | `31` |
| `envidoAcceptProbability` | `0.65` |
| `trucoRaiseStrength` | `0.78` |
| `trucoAcceptStrength` | `0.4` |
| `bluffRate` | `0.12` |
| `evaluationNoise` | `0.03` |
| `cardMistakeRate` | `0` |
| `usesCardMemory` | `true` |

## Decisiones (primeras 40)

| # | Mano | Baza | Cartas en mano | Envido | Marcador | Canto pendiente | Acción elegida |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1 | 1 | 12 de bast., 6 de oros, 6 de esp. | 6 | 0-0 | — | juega 12-bastos |
| 2 | 1 | 2 | 6 de oros, 6 de esp. | 6 | 0-0 | — | juega 6-espadas |
| 3 | 1 | 3 | 6 de oros | 6 | 0-0 | — | juega 6-oros |
| 4 | 2 | 1 | 3 de oros, 11 de copas, 10 de oros | 23 | 0-1 | — | juega 10-oros |
| 5 | 2 | 2 | 3 de oros, 11 de copas | 23 | 0-1 | — | canta TRUCO |
| 6 | 3 | 1 | 12 de copas, 2 de esp., 12 de oros | 2 | 1-1 | — | juega 2-espadas |
| 7 | 3 | 2 | 12 de copas, 12 de oros | 2 | 1-1 | — | canta TRUCO |
| 8 | 4 | 1 | 11 de bast., 1 de copas, 4 de oros | 4 | 2-1 | — | juega 4-oros |
| 9 | 4 | 2 | 11 de bast., 1 de copas | 4 | 2-1 | TRUCO | responde NO_QUIERO |
| 10 | 5 | 1 | 4 de esp., 7 de oros, 12 de copas | 7 | 2-2 | — | juega 7-oros |
| 11 | 5 | 2 | 4 de esp., 12 de copas | 7 | 2-2 | TRUCO | responde NO_QUIERO |
| 12 | 6 | 1 | 3 de esp., 5 de esp., 11 de oros | 28 | 2-3 | — | canta ENVIDO |
| 13 | 6 | 1 | 3 de esp., 5 de esp., 11 de oros | 28 | 3-3 | — | juega 11-oros |
| 14 | 6 | 2 | 3 de esp., 5 de esp. | 28 | 3-3 | — | canta TRUCO |
| 15 | 7 | 1 | 4 de bast., 10 de copas, 2 de copas | 22 | 4-3 | — | juega 2-copas |
| 16 | 7 | 2 | 4 de bast., 10 de copas | 22 | 4-3 | — | juega 4-bastos |
| 17 | 8 | 1 | 11 de esp., 4 de copas, 2 de esp. | 22 | 4-4 | ENVIDO | responde NO_QUIERO |
| 18 | 8 | 1 | 11 de esp., 4 de copas, 2 de esp. | 22 | 4-5 | — | juega 2-espadas |
| 19 | 8 | 2 | 11 de esp., 4 de copas | 22 | 4-5 | — | juega 11-espadas |
| 20 | 9 | 1 | 10 de copas, 6 de esp., 2 de esp. | 28 | 5-5 | — | canta ENVIDO |
| 21 | 9 | 1 | 10 de copas, 6 de esp., 2 de esp. | 28 | 6-5 | — | juega 2-espadas |
| 22 | 9 | 2 | 10 de copas, 6 de esp. | 28 | 6-5 | — | juega 10-copas |
| 23 | 9 | 3 | 6 de esp. | 28 | 6-5 | — | canta TRUCO |
| 24 | 10 | 1 | 3 de esp., 5 de oros, 11 de copas | 5 | 7-5 | — | juega 3-espadas |
| 25 | 10 | 2 | 5 de oros, 11 de copas | 5 | 7-5 | — | juega 11-copas |
| 26 | 10 | 3 | 5 de oros | 5 | 7-5 | — | juega 5-oros |
| 27 | 11 | 1 | 6 de bast., 6 de copas, 7 de bast. | 33 | 7-6 | — | canta REAL_ENVIDO |
| 28 | 11 | 1 | 6 de bast., 6 de copas, 7 de bast. | 33 | 8-6 | — | juega 7-bastos |
| 29 | 11 | 2 | 6 de bast., 6 de copas | 33 | 8-6 | TRUCO | responde NO_QUIERO |
| 30 | 12 | 1 | 2 de copas, 4 de bast., 3 de bast. | 27 | 8-7 | — | canta ENVIDO |
| 31 | 12 | 1 | 2 de copas, 4 de bast., 3 de bast. | 27 | 9-7 | — | juega 4-bastos |
| 32 | 12 | 2 | 2 de copas, 3 de bast. | 27 | 9-7 | — | juega 2-copas |
| 33 | 12 | 3 | 3 de bast. | 27 | 9-7 | — | canta TRUCO |
| 34 | 12 | 3 | 3 de bast. | 27 | 9-7 | — | juega 3-bastos |
| 35 | 12 | 3 |  | 27 | 9-7 | RETRUCO | responde QUIERO |
| 36 | 13 | 1 | 11 de esp., 10 de esp., 1 de oros | 20 | 12-7 | — | juega 1-oros |
| 37 | 13 | 2 | 11 de esp., 10 de esp. | 20 | 12-7 | — | juega 10-espadas |
| 38 | 14 | 1 | 6 de copas, 1 de esp., 1 de bast. | 6 | 12-8 | ENVIDO | responde NO_QUIERO |
| 39 | 14 | 1 | 6 de copas, 1 de esp., 1 de bast. | 6 | 12-9 | — | juega 1-bastos |
| 40 | 14 | 2 | 6 de copas, 1 de esp. | 6 | 12-9 | — | canta TRUCO |

### Lectura de las decisiones

- **Envido:** cantó 9 veces; el bot solo canta con tanto alto (umbral `envidoCallThreshold = 25`) y con la probabilidad de ganar la baza a favor.
- **Truco:** aceptó cuando su fuerza estimada superaba `trucoAcceptStrength = 0.4` y subió el canto por encima de `trucoRaiseStrength = 0.78`, mirando además el marcador (con el rival cerca del objetivo es más barato aceptar).
- **Cartas:** juega la carta mínima que le alcanza para ganar la baza (nunca quema el ancho si una carta baja sirve) y guarda la más alta para la tercera cuando la mano está pareja.
- **Memoria:** todas las estimaciones usan cartas ya vistas en la mesa y descartes del rival, nunca el mazo oculto; el bot no recibe información privada de otros asientos.
