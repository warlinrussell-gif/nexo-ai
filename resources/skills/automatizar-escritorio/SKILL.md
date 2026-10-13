---
name: Automatizar el escritorio
description: Guía para controlar Windows con capturas, ratón y teclado de forma fiable (abrir apps, rellenar formularios, usar programas sin API). Úsala siempre que vayas a usar la herramienta computer.
---

# Automatizar el escritorio (control del PC)

## Principios
- **Mira antes de actuar**: `computer(action="screenshot")` al empezar y tras cada cambio importante.
- **Coordenadas**: usa siempre el centro del elemento en la última captura. Si la captura cambió de tamaño, vuelve a capturar.
- **Lo más fiable primero**:
  1. Comandos directos (`open_app`, `run_command`) para abrir programas, archivos o URLs.
  2. Atajos de teclado.
  3. Clics con el ratón como último recurso.

## Atajos útiles de Windows
| Acción | Teclas |
|---|---|
| Menú Inicio / buscar app | `win`, escribir el nombre, `enter` |
| Ejecutar | `win+r` |
| Cambiar de ventana | `alt+tab` |
| Mostrar escritorio | `win+d` |
| Explorador de archivos | `win+e` |
| Maximizar ventana | `win+up` |
| Cerrar ventana | `alt+f4` (¡confirma antes si hay trabajo sin guardar!) |
| Barra de direcciones del navegador | `ctrl+l` |
| Copiar / pegar / deshacer | `ctrl+c` / `ctrl+v` / `ctrl+z` |
| Guardar | `ctrl+s` |
| Captura de región | `win+shift+s` |

## Flujo recomendado
1. Captura → identifica la ventana activa.
2. Si la app no está abierta: `open_app` (p. ej. "notepad", "calc", "spotify", "chrome").
3. Espera 1-2 s (`wait`) y vuelve a capturar.
4. Haz clic en el campo, escribe con `type`, confirma con `key: enter`.
5. Verifica con una captura final y resume lo que hiciste.

## Errores comunes
- Escribir sin haber enfocado el campo → haz clic primero.
- Ventanas emergentes (UAC, cookies, actualizaciones) → ciérralas o infórmalo.
- Si algo falla dos veces, cambia de estrategia (teclado ↔ ratón ↔ comando).

## Límites
No realices pagos, compras, envíos de mensajes/correos ni cambios de contraseñas sin confirmación explícita del usuario en ese momento.
