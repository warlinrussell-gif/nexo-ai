# Nexo AI

Estudio de IA de escritorio para **Windows** (también compila para Linux y macOS) que une modelos **locales** y **por API** con **agentes**, **MCP**, **skills**, **acceso total al ordenador**, **navegador integrado** y **voz** (incluido un modo manos libres estilo **JARVIS**).

## Instalación

1. Ejecuta `NexoAI-Setup-1.0.0.exe`.
2. Elige **en qué disco y carpeta** instalarlo (el instalador lo permite).
3. Al abrir Nexo por primera vez, el asistente te pide la **carpeta de datos**: ahí se guardan los modelos, motores, voces y chats. Por defecto es `NexoData` dentro de la carpeta de instalación, así que todo queda en el disco que elegiste. Puedes cambiarla (y mover los datos) desde *Ajustes → Almacenamiento*.
4. El asistente analiza tu equipo, instala el motor adecuado (CUDA, Vulkan o CPU) y te recomienda un primer modelo.

> Windows SmartScreen puede avisar porque el instalador no está firmado digitalmente: pulsa "Más información → Ejecutar de todas formas".
> Al desinstalar o actualizar, tus modelos y chats de `NexoData` se conservan (el desinstalador pregunta antes de borrarlos).

## Funciones principales

| Área | Qué hace |
|---|---|
| **Modelos locales** | Catálogo curado con los modelos actuales (Qwen3.5/3.6/3.8, Gemma 4, gpt-oss, GLM, LFM2.5, Fara, Devstral…), tendencias y búsqueda en todo Hugging Face. Descarga reanudable, varias cuantizaciones, visión (mmproj), importación de GGUF y carpetas de LM Studio. |
| **Análisis del equipo** | Detecta CPU, RAM (tipo y ancho de banda), GPUs y VRAM real. Lee la arquitectura de cada modelo (capas, KV caché, expertos MoE) directamente del archivo GGUF para calcular memoria y velocidad: **Fluido**, **Funciona bien**, **Funciona (lento)** o **No cabe**. |
| **Multi-modelo** | Varios modelos cargados a la vez con reparto automático de VRAM/RAM (offload por capas o expertos MoE en CPU). Si no caben, se cargan **por turnos** automáticamente. Modos **Comparar** (varios modelos responden a la vez) y **Etapas** (cada modelo hace una parte del mismo trabajo). El agente *Director de equipo* delega subtareas en otros agentes con otros modelos. |
| **APIs** | OpenAI, Anthropic (Claude), Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, Ollama, LM Studio y cualquier servidor compatible con OpenAI. Claves cifradas con el almacén seguro del sistema. |
| **Agentes** | Nexo (general), Operador del PC, Investigador, Programador, Director de equipo y JARVIS; crea los tuyos con prompt, modelo, herramientas, skills y MCP propios. |
| **Acceso al ordenador** | Archivos (leer, crear, editar, buscar, mover, borrar a la papelera), terminal PowerShell, abrir apps, procesos, portapapeles, notificaciones y **control total de ratón, teclado y pantalla** para modelos con visión (Claude, GPT, Gemini, Qwen-VL, Fara, UI-Mate…). Mientras controla el PC, Nexo se minimiza y muestra una píldora con botón **Detener** (Ctrl+Alt+Q). |
| **Permisos** | Tres niveles: *Preguntar*, *Inteligente* (recomendado) y *Acceso total*, también por chat. |
| **Web** | Búsqueda sin claves (o Brave/Tavily/SearXNG), lectura de páginas con JavaScript y **navegador integrado** que los agentes controlan mientras lo ves (clic, escribir, formularios, capturas). |
| **MCP** | Servidores stdio, HTTP y SSE; galería con un clic; importación desde Claude Desktop o JSON. |
| **Skills** | Formato `SKILL.md` (compatible con Agent Skills). Incluye 5 skills en español; crea o importa las tuyas. |
| **Voz** | Dictado, conversación por voz a pantalla completa y **modo JARVIS**: di "Jarvis, …" desde cualquier lugar (incluso minimizado). Transcripción local con whisper.cpp o por API (Groq/OpenAI); voz del sistema, **Piper** neural local (voces en español de España, México y Argentina, y la británica "Alan" estilo JARVIS), OpenAI o ElevenLabs. Atajo global Ctrl+Shift+Espacio. |
| **Interfaz** | Tema oscuro/claro, color de acento, paleta de comandos (Ctrl+K), historial con búsqueda, adjuntos por arrastrar y pegar, razonamiento plegable, tarjetas de herramientas con capturas, planes de tareas, estadísticas de tok/s, memoria persistente, exportación a Markdown. |

## Atajos

- `Ctrl+K` paleta de comandos · `Ctrl+N` nuevo chat · `Ctrl+B` historial · `Ctrl+,` ajustes
- `Ctrl+Shift+Espacio` voz global · `Ctrl+Alt+Q` detener el control del PC · `Esc` detener respuesta

## Compilar desde el código

```bash
npm install
npm run icons        # genera iconos
npm run catalog      # (opcional) regenera el catálogo de modelos desde Hugging Face
npm run dev          # compila la interfaz y abre la app
npm run dist:win     # instalador NSIS para Windows (release/NexoAI-Setup-x.y.z.exe)
npm run dist:linux   # AppImage
npm run dist:mac     # DMG (en macOS)
```

Pruebas: `node scripts/test-core.mjs` (motor, descarga de modelo, agente con herramientas, comparar, etapas, web y MCP).

## Estructura

```
src/main/        proceso principal (Electron): motor, modelos, agentes, herramientas, MCP, voz, navegador
src/shared/      estimador de memoria/velocidad (compartido)
src/renderer/    interfaz React
resources/       iconos y skills integradas
build/           recursos del instalador
scripts/         catálogo, iconos, pruebas y hooks de empaquetado
```
