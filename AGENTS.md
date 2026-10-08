# Reglas del baseline

- Baseline exclusivamente local y sintético. No desplegar, cambiar DNS, provisionar recursos o activar leads/analítica sin autorización explícita.
- Respetar el lockfile, las versiones de Node/npm y las convenciones existentes. Reutilizar código y bibliotecas actuales antes de añadir dependencias.
- No subir secretos, WXR bruto, bases de datos, cachés, estado local, registros internos ni medios sin autorización. El repositorio y los logs de CI son públicos.
- `content/facts.yaml` registra observaciones y aprobaciones; solo los hechos con aprobación válida son elegibles para publicación. Cambiar el valor de un hecho aprobado exige retirar su aprobación antes de una aprobación posterior independiente.
- EmDash se limita al blog en este baseline. No describir como implementadas las ampliaciones pendientes, ni la seguridad o recuperación de producción.
- Verificar cambios mediante `npm run guard-content`, `npm run check`, `npm run build` y un smoke del flujo local afectado. Usar `local:worker` para comprobar el Worker y la autenticación editorial.
- Pull requests contra `main`; GitHub Actions valida sin desplegar. CODEOWNERS no sustituye la protección remota de rama.
