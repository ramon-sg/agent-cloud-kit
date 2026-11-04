# Expo en la nube (verificado)

Fecha: 2026-11-03. Repo de prueba privado `ramon-sg/cloud-spike`, rama `spike/expo` (una app de
la plantilla de Expo SDK 58 en `app/`, con un test de `jest-expo`, una pantalla con
`expo-glass-effect` y `expo-symbols`, y dos tests de Playwright contra el export web; las
pruebas son `probe/expo.sh` y `probe/expo-net.sh`). Resultados en `spike/expo-result` y
`spike/expo-net-result`. Sesiones `session_01L3JBJujD4HotXpvQr1Fkbq` y
`session_01L3JBJroRE7WyFUzfiKyNJr`. Entorno "Prueba": red Limitado, "Permitir administradores
de paquetes" encendido, `npmmirror.com` y `cdn.npmmirror.com` agregados; sin variables ni setup
script. Expo 58.0.23, React Native 0.88.1, Playwright 1.64.1, Node 22.23.4 (el de la imagen).

## Resultado

| Paso | Resultado |
| --- | --- |
| Máquina | Ubuntu 24.04.5, root, 4 CPUs, 15 GB, sin `/dev/kvm`, sin Android SDK ni `adb`, Java 21, sin watchman. |
| `npm ci` | Pasa (48 s). |
| `jest` (`jest-expo`, Testing Library) | Pasa (10 s). |
| `tsc --noEmit` | Falla igual que en local (la plantilla necesita `expo customize tsconfig.json`): no es de la nube. |
| `expo-doctor` (también con `EXPO_OFFLINE=1` y con `EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS=1`) | Sale con 1: `ENOTFOUND exp.host` en el chequeo del esquema y falla el de React Native Directory. |
| `expo export` web; Android e iOS con `EXPO_OFFLINE=1` | Pasan (29–36 s). |
| `expo prebuild --no-install`, Android e iOS | Pasan (~5 s); además de `android/` e `ios/`, cambian `app.json` y `package.json`. |
| `expo start --web` | Sirve en `127.0.0.1:8081`. |
| Playwright con el Chrome de la imagen (`executablePath`) | Pasa (7 s), con capturas. |
| `npx playwright install chromium` | 403 del proxy: `cdn.playwright.dev` no está en la lista. La imagen trae los navegadores de `playwright@1.63.0`, y el repo usaba 1.64.1. |
| Web: `GlassView` | Un `View` común; el contenido se ve. |
| Web: `SymbolView` | Con `{ ios, android, web }` dibuja la estrella (fuente Material Symbols, en el bundle); con solo `star.fill`, el `fallback`. Sin errores en la página. |
| `./gradlew assembleDebug` | Falla en ~1 min resolviendo plugins: Maven Central responde 429 ("Your ip has exceeded rate limits") a lo que no tiene y `maven.google.com` redirige a `dl.google.com` (403). |
| Red | `registry.npmjs.org`, `maven.google.com` (solo el índice), `plugins.gradle.org`, `services.gradle.org`: sí. `exp.host`, `api.expo.dev`, `expo.dev`, `reactnative.directory`, `dl.google.com`, `cdn.playwright.dev`, `playwright.download.prss.microsoft.com`: no. Maven Central: 200 a lo que existe, 429 a lo que no. |

## Qué cambió en la skill

`knowledge.md`: las filas de Expo pasan a verificado (lo que corre, `expo-doctor`, web), se
corrige `expo-symbols` (sí dibuja en web con un nombre para web), se agregan los navegadores de
Playwright 1.63 de la imagen, los dominios de Expo y Playwright que faltan, el 429 de Maven
Central y la redirección de `maven.google.com`. `compat.md`: la tabla de Expo, el build de
Android (hoy fuera) y la alternativa del Chrome de la imagen para Playwright.

## Sin probar

`expo-doctor` y el build de Android con los dominios agregados (`exp.host`, `api.expo.dev`,
`reactnative.directory`; `dl.google.com` y el SDK en el setup); `@expo/ui` en web.
