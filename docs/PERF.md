# Rendimiento y Capacidad (`PERF.md`)

> **Estado:** Objetivos base fijados en **M0**. Ejecución y reporte de pruebas k6 (100 y 1.000 usuarios concurrentes), perfiles de bundle y planes `EXPLAIN` se completan en **M8** (`STATE-08`).

## Objetivos de nivel de servicio (MVP)

- **Latencia de acción WS confirmada (p95 en región):** < 150 ms.
- **Bundle JS crítico comprimido (`apps/web`):** < 200 KB gzip.
- **Estabilidad concurrente inicial validada:** 100 partidas simultáneas sin degradación y prueba de estrés a 1.000 usuarios simultáneos.
