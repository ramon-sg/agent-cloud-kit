# Electron en la nube (verificado)

Fecha: 2026-11-03. Repo de prueba privado `ramon-sg/cloud-spike`, rama `spike/electron` (la
prueba, `probe/electron.sh`) y `spike/electron-result` (el reporte, los logs y las capturas).
Sesión `session_01L3JBJtE6ZybCAACv377R9V`. Entorno "Prueba": red Limitado, "Permitir
administradores de paquetes" encendido, `npmmirror.com` y `cdn.npmmirror.com` agregados; sin
variables ni setup script. Electron 45.2.1, Playwright 1.64.1, Node 22.23.4 (el de la imagen).

## Resultado

| Paso | Resultado |
| --- | --- |
| Máquina | Ubuntu 24.04.5, kernel 6.18 (Firecracker), root, `DISPLAY` vacío, sin `/dev/kvm`. |
| Xvfb, `xauth`, ImageMagick, librerías de Chromium (`libgtk-3-0t64`, `libatk-bridge2.0-0t64`, `libasound2t64`, …) | Ya instalados en la imagen: `apt-get install` no instaló nada (7 s). |
| Bajar Electron de GitHub, sin variables | Funciona (8 s): `releases/download` redirige a `release-assets.githubusercontent.com`, 200. |
| Con `ELECTRON_GET_USE_PROXY=1`, con `ELECTRON_MIRROR` (npmmirror), con los dos | Funcionan; no hacen falta. |
| Wrapper de Gradle (`services.gradle.org`) | 200 (redirige a releases de GitHub). |
| `dl.google.com` | No responde (no está en la lista por defecto). |
| Electron sin Xvfb | `Missing X server or $DISPLAY`, sale con 1. |
| Electron sin `--no-sandbox` | `Running as root without --no-sandbox is not supported`, SIGTRAP. |
| `xvfb-run -a npx electron … --no-sandbox` | Arranca (`ELECTRON_READY 45.2.1`). Ruido en el log: `dbus` y "The NODE_OPTION --use-openssl-ca is not supported in Electron". |
| `webContents.capturePage()` | Falla con `UnknownVizError`. |
| `import -window root` dentro del mismo `xvfb-run` | Captura la pantalla (1280×1024) con la ventana. |
| Playwright `_electron.launch({ args: [main, "--no-sandbox"] })` bajo `xvfb-run -a` | Pasa en 1,8 s; `page.screenshot` funciona. |

## Qué cambió en la skill

`knowledge.md`: los releases públicos de GitHub sí se bajan (antes decía que fallaban), la
imagen trae Xvfb y las librerías de Chromium, no hay `/dev/kvm`, `dl.google.com` no está en la
lista, `NODE_OPTIONS` lleva `--use-openssl-ca`, y las filas de Electron pasan a verificado.
`compat.md`: la sección "Electron" queda en cuatro pasos sin `apt` ni mirror.
