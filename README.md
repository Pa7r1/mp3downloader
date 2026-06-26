# YDL — YouTube Downloader

Descargador local de YouTube en **MP3** (audio) o **MP4** (video), con interfaz web y
extensión de Chrome. Funciona enteramente en tu máquina: un servidor Node levanta
`yt-dlp`, muestra el progreso en tiempo real y te entrega el archivo final.

## ¿Qué incluye?

- **Servidor Node/Express** que orquesta las descargas con `yt-dlp` y reporta el avance
  por SSE (Server-Sent Events).
- **Interfaz web** (sin frameworks) con preview del video, cola de descargas y soporte
  de playlists.
- **Extensión de Chrome** (Manifest V3) que descarga desde una ventana emergente y
  autoarranca el servidor mediante *native messaging*.

## Requisitos

- **Node.js 20+**
- **yt-dlp** instalado y disponible en el `PATH`.
- **ffmpeg** en el `PATH` (lo usa `yt-dlp` para convertir a MP3 y fusionar video+audio).
- **`~/yt-cookies.txt`** — un export de cookies de YouTube en formato Netscape. Es
  obligatorio: todas las llamadas a `yt-dlp` lo pasan con `--cookies` y sin él fallan
  los videos con restricción de edad/región o verificación de bot.

## Instalación

```bash
npm install
```

## Uso (interfaz web)

```bash
npm run dev     # desarrollo, con recarga (node --watch)
npm start       # producción
```

El servidor queda en `http://localhost:3100` (o el puerto de `$PORT`).

1. Pegá la URL de un video o playlist de YouTube.
2. Vas a ver un preview con título, canal, duración y tamaño estimado.
3. Elegí **audio (MP3)** o **video (MP4)** y descargá.
4. Las descargas se encolan y muestran el progreso una por una. En playlists podés
   elegir qué videos bajar desde un modal.

Los archivos se generan en `./temp/`, se envían al navegador y se borran solos. Además
hay una limpieza automática de cualquier archivo de `./temp/` con más de 1 hora (al
iniciar, al cerrar y cada 30 minutos).

## Uso (extensión de Chrome)

1. Abrí `chrome://extensions`, activá **Modo desarrollador** y cargá la carpeta
   `extension/` con **Cargar extensión sin empaquetar**.
2. Configurá el *native host* (registra el puente que autoarranca el servidor):

   ```bash
   cd host && bash install.sh
   ```

   El script te pide el **ID de la extensión** (lo ves en `chrome://extensions`) e
   instala el manifest de native messaging para Chrome y Chromium.
3. Abrí la extensión desde la barra de Chrome, pegá la URL y descargá. Si el servidor no
   está corriendo, la extensión lo levanta sola a través del host.

## Endpoints del servidor

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/detect-url` | Detecta si la URL es video o playlist y devuelve su info. |
| `POST` | `/get-video-info` | Info de un video (título, duración, tamaños, etc.). |
| `POST` | `/get-video-title` | Solo el título del video. |
| `POST` | `/start-download` | Inicia la descarga (`format`: `audio` o `video`) y devuelve un `downloadId`. |
| `GET`  | `/progress/:downloadId` | Stream SSE de progreso (`info` → `progress` → `ready`/`error`). |
| `GET`  | `/file/:downloadId` | Descarga el archivo generado y limpia el temporal. |
| `GET`  | `/health` | Chequeo de salud del servidor. |

## Estructura

```
server.js        # backend Express: yt-dlp, SSE, entrega y limpieza de archivos
public/          # interfaz web (index.html, script.js, style.css)
extension/       # extensión Chrome MV3 (popup + service worker)
host/            # native messaging host que autoarranca el servidor
```

## Notas

- `yt-dlp` resuelve los retos de JavaScript del player usando el propio Node
  (`--js-runtimes`); por eso conviene tener una versión reciente de `yt-dlp`.
- No incluye framework de tests ni de linting.
