---
name: Investigación profunda
description: Investiga un tema a fondo en internet con varias búsquedas, lectura de fuentes y contraste de datos, y entrega un informe con conclusiones y enlaces. Úsala para preguntas complejas, comparativas, estudios de mercado o noticias recientes.
---

# Investigación profunda

## Método
1. **Descompón** la pregunta en 3-6 subpreguntas concretas. Muéstralas con `update_plan`.
2. **Busca** cada subpregunta con `web_search` usando formulaciones distintas (español e inglés, términos técnicos, fechas del año actual).
3. **Lee** las 3-5 fuentes más fiables con `fetch_url` (o `browser` si la página necesita interacción). Prioriza: fuentes oficiales, documentación, prensa de referencia, artículos académicos.
4. **Contrasta**: si dos fuentes discrepan, dilo y explica cuál parece más fiable y por qué.
5. **Anota fechas**: indica de cuándo es cada dato; descarta información desactualizada si hay algo más reciente.

## Formato del informe
- **Resumen ejecutivo** (3-5 frases con la respuesta directa).
- **Hallazgos** por subpregunta, con datos concretos (cifras, fechas, nombres).
- **Tabla comparativa** cuando haya varias opciones.
- **Conclusión / recomendación**.
- **Fuentes**: lista de enlaces con título.

## Reglas
- No inventes datos ni enlaces: cita solo lo que has leído.
- Si no encuentras algo, dilo claramente.
- Si el usuario lo pide, guarda el informe con `write_file` en Markdown en su carpeta de Documentos.
