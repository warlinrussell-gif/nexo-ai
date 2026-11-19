---
name: Desarrollo web rápido
description: Crea páginas y aplicaciones web modernas (HTML/CSS/JS o proyectos con Node) directamente en el disco del usuario, las prueba y las abre en el navegador. Úsala para landings, portfolios, prototipos o herramientas web.
---

# Desarrollo web rápido

## Para una página sencilla (sin dependencias)
1. Crea una carpeta de proyecto (p. ej. en el Escritorio) con `write_file`:
   - `index.html` (HTML5 semántico, `<meta name="viewport">`, idioma `es`)
   - `styles.css` (variables CSS, diseño responsive con flex/grid, modo oscuro opcional)
   - `script.js` (solo si hace falta interactividad)
2. Diseño moderno: tipografía del sistema (`system-ui`), espaciado generoso, esquinas redondeadas, sombras suaves, un color de acento, secciones claras (hero, características, CTA, pie).
3. Ábrela con `open_app` pasando la ruta del `index.html`, o en el navegador integrado con `browser(action="navigate", url="file:///RUTA/index.html")` y revisa con `browser(action="screenshot")`.
4. Corrige lo que se vea mal y vuelve a comprobar.

## Para proyectos con Node (React, Vite…)
1. Comprueba Node: `run_command("node -v; npm -v")`. Si no existe, ofrece instalarlo (Windows: `winget install OpenJS.NodeJS.LTS`).
2. `npm create vite@latest NOMBRE -- --template react` y `npm install` (con timeout alto).
3. Para el servidor de desarrollo usa `run_command` con `background=true` y luego navega a `http://localhost:5173`.
4. Para producción: `npm run build`.

## Calidad
- Accesibilidad: textos alternativos, contraste suficiente, foco visible.
- Nada de lorem ipsum si el usuario dio contenido real.
- Explica al final cómo abrir/editar el proyecto.
