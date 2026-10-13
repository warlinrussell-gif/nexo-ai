---
name: Organizar archivos
description: Ordena carpetas desordenadas (Descargas, Escritorio, fotos, documentos) clasificando por tipo, fecha o proyecto, detecta duplicados y archivos grandes, siempre mostrando un plan antes de mover nada.
---

# Organizar archivos

## Pasos
1. **Explora** la carpeta con `list_directory` (profundidad 1-2). Si hay muchos archivos, usa `run_command` para obtener un resumen por extensión y tamaño:
   - Windows (PowerShell): `Get-ChildItem -File -Path "RUTA" | Group-Object Extension | Sort-Object Count -Descending | Select Name,Count`
   - Archivos grandes: `Get-ChildItem -File -Recurse "RUTA" | Sort-Object Length -Descending | Select -First 20 FullName,@{n='MB';e={[math]::Round($_.Length/1MB,1)}}`
2. **Propón un plan** claro antes de actuar (carpetas destino y reglas). Ejemplo de categorías:
   - Documentos: pdf, doc(x), xls(x), ppt(x), txt, md, csv
   - Imágenes: jpg, jpeg, png, gif, webp, heic, svg
   - Vídeos: mp4, mov, mkv, avi, webm
   - Audio: mp3, wav, flac, m4a
   - Comprimidos: zip, rar, 7z, tar, gz
   - Instaladores: exe, msi, dmg, pkg
   - Código: py, js, ts, html, css, json, ipynb
3. **Pide confirmación** del plan salvo que el usuario ya haya dado permiso explícito.
4. **Ejecuta** con `move_path` o, para muchos archivos, con un único script de PowerShell/bash bien probado. Nunca sobrescribas: si existe un archivo con el mismo nombre, añade un sufijo.
5. **Duplicados**: detéctalos por hash (`Get-FileHash`) y propón enviarlos a la papelera con `delete_path` (papelera por defecto).
6. **Informa** del resultado: cuántos archivos se movieron a cada carpeta y espacio liberado.

## Seguridad
- Nunca borres definitivamente sin permiso explícito (usa la papelera).
- No toques carpetas del sistema (Windows, Program Files, AppData) salvo petición expresa.
