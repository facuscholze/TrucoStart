# Rendimiento y Capacidad (`PERF.md`)

> **Estado:** Objetivos base fijados en **M0**. Ejecución y reporte de pruebas k6 (100 y 1.000 usuarios concurrentes), perfiles de bundle y planes `EXPLAIN` se completan en **M8** (`STATE-08`).

## Objetivos de nivel de servicio (MVP)

- **Latencia de acción WS confirmada (p95 en región):** < 150 ms.
- **Bundle JS crítico comprimido (`apps/web`):** < 200 KB gzip.
- **Estabilidad concurrente inicial validada:** 100 partidas simultáneas sin degradación y prueba de estrés a 1.000 usuarios simultáneos.

---

## Benchmark de la IA de Truco (BL-010, M6)

> **Estado:** medido el **2026-11-13** en el sandbox de CI local (Node 20, `pnpm --filter @truco/engine build`), con el motor puro y sin red. Reproducible con `pnpm --filter @truco/engine exec vitest run tests/bot-benchmark.spec.ts`.

### Metodología

- **Motor:** `@truco/engine` `AR_STANDARD_V1` (30 puntos, sin Flor en el set base usado), 1v1, sin temporizadores.
- **Simulador:** `simulateMatch` de `packages/truco-engine/src/simulator.ts`. Cada partida usa una semilla propia (`seed = base + i`) y **alterna el lado de la mesa** (par = retador en equipo 0, impar = retador en equipo 1) para cancelar la ventaja de ser mano y la varianza del reparto.
- **Agentes enfrentados:** `HARD` / `MEDIUM` / `EASY` (IA nueva parametrizada), `LEGACY` (bot heurístico de M1, `bot-legacy.ts`) y `RANDOM` (acción uniforme entre las legales).
- **Muestras:** **2.000 partidas por enfrentamiento** (~138 s en total, **~10 ms de CPU por partida** con la IA difícil, que ejecuta un Monte Carlo de 120 muestras por decisión de canto).
- **Intervalos de confianza:** Wilson 95% (`wilsonInterval` en `src/benchmark.ts`), más estable que el intervalo normal con proporciones extremas.
- **Reproducibilidad:** ambos agentes reciben el `Rng` sembrado del simulador, por lo que cada enfrentamiento es **determinista** para un `baseSeed` dado (`20260101`).

### Resultados

| Enfrentamiento                   | Partidas | Victorias del retador | Win rate  | IC 95%        | Acciones/partida |
| -------------------------------- | -------: | --------------------: | --------- | ------------- | ---------------: |
| **Difícil vs Bot anterior (M1)** |    2.000 |                 1.259 | **62,9%** | 60,8% – 65,0% |              157 |
| Difícil vs Medio                 |    2.000 |                 1.233 | 61,7%     | 59,5% – 63,8% |              152 |
| Difícil vs Fácil                 |    2.000 |                 1.595 | 79,8%     | 77,9% – 81,5% |              156 |
| Medio vs Bot anterior (M1)       |    2.000 |                   991 | 49,5%     | 47,4% – 51,7% |              162 |
| Medio vs Fácil                   |    2.000 |                 1.471 | 73,6%     | 71,6% – 75,4% |              164 |
| Difícil vs Random                |    2.000 |                 1.951 | 97,5%     | 96,8% – 98,1% |               66 |

**Criterio de aceptación de M6 (difícil > 60% vs bot anterior): cumplido** — 62,9% con IC 95% `[60,8%, 65,0%]`, es decir, el límite inferior del intervalo también supera el 60%.

### Lectura de los resultados

- **La escalera de dificultad es monótona y monótona en el margen:** difícil `>` medio (`63,2%`, IC `[61,1%, 65,3%]`), medio `>` fácil (`72,5%`) y difícil `»` fácil (`79,8%`). Un nivel fácil con `usesCardMemory: false`, ruido de evaluación `0,22` y `cardMistakeRate 0,15` pierde 4 de cada 5 partidas contra el difícil.
- **El bot anterior (M1) es fuerte pero explotable:** el nivel medio queda a la par (`49,5%`), lo que confirma que la mejora viene de la nueva evaluación de mano y de las reglas de canto, no de un salto de dificultad artificial.
- **Contra el azar** el nivel difícil gana `98,0%` y necesita solo `66` acciones por partida (el rival aleatorio no alarga las manos con cantos).
- **Costo de CPU:** el Monte Carlo (`estimateHandWinRate`, 120 muestras) solo se ejecuta cuando hay una decisión de Truco pendiente o se evalúa cantar/subir (bajo demanda y memoizado por decisión), no en cada jugada de carta. Con eso una partida completa de dos bots difíciles cuesta **~10 ms de CPU**; en un servidor autoritativo con `turnTimeoutMs` de 20 s y una demora humana simulada por jugada el margen es holgado.

### Parámetros finales por dificultad

| Parámetro                                       | Fácil | Medio | Difícil |
| ----------------------------------------------- | ----: | ----: | ------: |
| `envidoCallThreshold` (tanto para cantar)       |    30 |    27 |      25 |
| `envidoRaiseThreshold` (tanto para Real Envido) |    33 |    32 |      31 |
| `envidoAcceptProbability` (para "Quiero")       |  0,62 |  0,55 |    0,65 |
| `trucoRaiseStrength` (fuerza para cantar Truco) |  0,85 |  0,70 |    0,78 |
| `trucoAcceptStrength` (fuerza para "Quiero")    |  0,62 |  0,50 |    0,40 |
| `bluffRate` (farol moderado)                    |  0,02 |  0,07 |    0,12 |
| `evaluationNoise`                               |  0,22 |  0,10 |    0,03 |
| `cardMistakeRate`                               |  0,15 |  0,05 |    0,00 |
| `usesCardMemory`                                |    no |    sí |      sí |

Los umbrales se obtuvieron por descenso coordenado sobre semillas de tuning (`700k+`, 500 partidas por punto) y se validaron después en semillas independientes (`20260101`, 2.000 partidas). Los valores son explicables: aceptar un Truco es barato porque rechazarlo igual entrega los puntos ya cantados (`P > ~0,3` ya es rentable), mientras que subir el canto exige `P` alta para que el rival acepte; por eso `trucoAcceptStrength` baja y `trucoRaiseStrength` queda cerca de `0,8`.

## Log de decisiones del bot difícil (M6)

El detalle turno por turno de una partida difícil vs difícil (qué ve el bot desde su `PlayerView`, tanto de envido, marcador, canto pendiente y acción elegida) se genera con `node packages/truco-engine/scripts/m6-decision-log.mjs` y queda en [`docs/BOT_DECISION_LOG.md`](./BOT_DECISION_LOG.md).
