# 📋 Descargador de Videos y Música

Este proyecto es un sistema **cliente-servidor completo** que permite descargar contenido desde enlaces de YouTube en formato **video (MP4)** o **audio (MP3)**, con selección de calidad y manejo de colas de descarga.  
Fue desarrollado como parte de mi portafolio para practicar arquitectura fullstack, procesamiento de streams y conversión multimedia.

---

## 🔧 Backend (Node.js + Express)

### API REST construida con Express
- Uso de **@distube/ytdl-core** para obtener información de los videos y stream de contenido.
- **FFmpeg** integrado para conversión de audio a MP3 con calidad configurable.

### Clases utilitarias
- **FileManager** → gestión de directorios, archivos temporales y limpieza automática.
- **YouTubeValidator** → validación robusta de URLs.
- **VideoProcessor** → obtención de metadatos, selección de formatos y conversión de audio.

### Rutas principales
- `GET /get-video-info` → obtener información completa del video.  
- `GET /get-video-title` → obtener solo el título (endpoint ligero).  
- `POST /download-video` → descarga en MP4.  
- `POST /download-audio` → descarga y conversión a MP3.  

### Seguridad
- Sanitización de nombres de archivo.  
- Middleware **CORS** configurado para entornos de desarrollo y producción.  
- Manejo robusto de errores y limpieza de archivos temporales.  

---

## 🎨 Frontend (HTML + CSS + JS)

### Interfaz moderna con:
- Input de URL con validación en vivo.  
- Previsualización del video (**thumbnail, título, canal, duración**).  
- Selección de formato: **Video / Audio**.  
- Selección de calidad: **1080p, 720p, 320kbps**, etc.  
- Barra de progreso animada con pasos de descarga.  
- Cola de descargas con estados:  
  *(En cola, Descargando, Convirtiendo, Completado, Error)*  

### Clase principal
**ImprovedYouTubeDownloader**:
- Lógica de descargas en cola.  
- Sistema avanzado de progreso con pasos *(Inicializando, Descargando, Convirtiendo, Finalizando)*.  
- Notificaciones y validación de URLs.  
- Animaciones en transiciones de estados.  

---

## ⚡ Características destacadas
- Conversión de audio a MP3 con **bitrate ajustable** (128 kbps a 320 kbps).  
- Descarga de videos con audio incluido en **MP4**.  
- **Cola de descargas** con control de progreso y cancelación.  
- **Sistema automático de limpieza** de archivos temporales cada 30 minutos.  
- Compatible con **Windows, Linux y Mac**.  

---

## 🚀 Instalación y uso

1. Clonar repositorio:
   git clone https://github.com/Pa7r1/mp3downloader.git
   cd mp3downloader

2. Instalar Dependencias:
  npm install

3. Iniciar Servidor:
 npm run dev

4. Abrir el frontend en el navegador:
 http://localhost:3000
