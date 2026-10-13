---
name: Documentos de oficina
description: Crea y edita documentos Word, hojas de Excel, presentaciones y PDFs en el equipo del usuario usando Python (python-docx, openpyxl, python-pptx) o, si no hay Python, HTML/Markdown convertidos. Úsala para informes, facturas, tablas, cartas o presentaciones.
---

# Documentos de oficina

## Preparación
1. Comprueba Python: `run_command("python --version")` (en Windows también `py --version`).
2. Si falta, ofrece instalarlo: `winget install Python.Python.3.12`.
3. Instala las librerías necesarias solo una vez:
   `python -m pip install --user python-docx openpyxl python-pptx reportlab`

## Método
1. Escribe un script en el directorio de trabajo con `write_file` (p. ej. `crear_informe.py`).
2. Ejecútalo con `run_command` y revisa errores; corrige y repite.
3. Guarda el documento donde pida el usuario (por defecto, Documentos) y ábrelo con `open_app`.

## Plantillas rápidas
- **Word**: título (`add_heading`), párrafos, listas, tablas con estilo `Light Grid Accent 1`, saltos de página.
- **Excel**: encabezados en negrita con relleno, anchos de columna ajustados, formato numérico/moneda, fórmulas (`=SUMA` → en openpyxl usa nombres en inglés: `=SUM(B2:B10)`), filtros y paneles inmovilizados.
- **PowerPoint**: 16:9, una idea por diapositiva, títulos cortos, máximo 5 viñetas.
- **PDF**: reportlab, o genera HTML y conviértelo abriéndolo en el navegador (imprimir a PDF).

## Si no hay Python
Crea el contenido en HTML bien maquetado o CSV (Excel lo abre) y explica cómo guardarlo en el formato deseado.
