import express from "express";
import cors from "cors";
import ytdl from "@distube/ytdl-core";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import fsSync from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import sanitize from "sanitize-filename";
import { createWriteStream, createReadStream } from "fs";
import { pipeline } from "stream/promises";

// ===== CONFIGURACIÓN =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

// Configurar FFmpeg
try {
  ffmpeg.setFfmpegPath(ffmpegPath.path);
  console.log("✅ FFmpeg configurado correctamente:", ffmpegPath.path);
} catch (error) {
  console.error("❌ Error configurando FFmpeg:", error);
  process.exit(1);
}

// ===== UTILIDADES =====
class FileManager {
  constructor() {
    this.tempDir = path.join(__dirname, "temp");
    this.publicDir = path.join(__dirname, "public");
    this.initDirectories();
  }

  async initDirectories() {
    for (const dir of [this.tempDir, this.publicDir]) {
      try {
        await fs.mkdir(dir, { recursive: true });
        console.log(`📁 Directorio inicializado: ${dir}`);
      } catch (error) {
        console.error(`❌ Error creando directorio ${dir}:`, error);
      }
    }
  }

  /**
   * Limpia archivos temporales de más de 1 hora
   */
  async cleanupOldFiles() {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      const maxAge = 60 * 60 * 1000; // 1 hora

      await Promise.all(
        files.map(async (file) => {
          const filePath = path.join(this.tempDir, file);
          try {
            const stats = await fs.stat(filePath);
            const fileAge = now - stats.mtime.getTime();

            if (fileAge > maxAge) {
              await fs.unlink(filePath);
              console.log(`🗑️ Archivo temporal eliminado: ${file}`);
            }
          } catch (error) {
            console.error(`Error procesando archivo ${file}:`, error);
          }
        })
      );
    } catch (error) {
      console.error("❌ Error en limpieza de archivos:", error);
    }
  }

  generateTempPath(extension = "tmp") {
    return path.join(
      this.tempDir,
      `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${extension}`
    );
  }

  async safeUnlink(filePath) {
    try {
      if (fsSync.existsSync(filePath)) {
        await fs.unlink(filePath);
      }
    } catch (error) {
      console.error(`Error eliminando archivo ${filePath}:`, error);
    }
  }
}

class YouTubeValidator {
  /**
   * Valida si una URL es de YouTube
   */
  static isValidYouTubeURL(url) {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname.includes("youtube.com") ||
        urlObj.hostname.includes("youtu.be")
      );
    } catch {
      return false;
    }
  }

  /**
   * Valida URL usando ytdl-core
   */
  static validateWithYtdl(url) {
    return ytdl.validateURL(url);
  }
}

class VideoProcessor {
  /**
   * Formatea duración en segundos a HH:MM:SS
   */
  static formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${remainingSeconds
        .toString()
        .padStart(2, "0")}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  /**
   * Obtiene información del video
   */
  static async getVideoInfo(url) {
    const info = await ytdl.getInfo(url);
    const { videoDetails } = info;

    return {
      videoId: videoDetails.videoId,
      title: videoDetails.title || "Título no disponible",
      duration: this.formatDuration(parseInt(videoDetails.lengthSeconds) || 0),
      channel: videoDetails.author?.name || "Canal no disponible",
      views: parseInt(videoDetails.viewCount) || 0,
      thumbnail: videoDetails.thumbnails?.[0]?.url || "",
      available: true,
    };
  }

  /**
   * Selecciona el mejor formato de video
   */
  static selectVideoFormat(formats, quality = "highest") {
    const videoFormats = formats.filter(
      (format) =>
        format.hasVideo && format.hasAudio && format.container === "mp4"
    );

    if (videoFormats.length === 0) {
      throw new Error("No hay formatos de video con audio disponibles");
    }

    if (quality === "highest") {
      return videoFormats.reduce((prev, current) =>
        (parseInt(current.height) || 0) > (parseInt(prev.height) || 0)
          ? current
          : prev
      );
    }

    return (
      videoFormats.find(
        (format) =>
          format.qualityLabel?.includes(quality) || format.quality === quality
      ) || videoFormats[0]
    );
  }

  /**
   * Convierte audio a MP3
   */
  static convertToMP3(inputPath, outputPath, bitrate = 320) {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioBitrate(bitrate)
        .audioChannels(2)
        .audioFrequency(44100)
        .format("mp3")
        .on("end", () => {
          console.log("✅ Conversión a MP3 completada");
          resolve();
        })
        .on("error", reject)
        .on("progress", (progress) => {
          if (progress.percent) {
            console.log(
              `🔄 Progreso conversión: ${Math.round(progress.percent)}%`
            );
          }
        })
        .save(outputPath);
    });
  }
}

// ===== INICIALIZACIÓN =====
const app = express();
const fileManager = new FileManager();

// Middleware
app.use(
  cors({
    origin:
      process.env.NODE_ENV === "production"
        ? process.env.ALLOWED_ORIGINS?.split(",")
        : ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.static(fileManager.publicDir));

// Limpieza periódica cada 30 minutos
setInterval(() => fileManager.cleanupOldFiles(), 30 * 60 * 1000);

// ===== RUTAS =====

/**
 * Página principal
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(fileManager.publicDir, "index.html"));
});

/**
 * Obtiene información completa del video
 */
app.post("/get-video-info", async (req, res) => {
  const { url: videoURL } = req.body;

  console.log("📋 Solicitando información para:", videoURL);

  // Validaciones
  if (!videoURL || !YouTubeValidator.isValidYouTubeURL(videoURL)) {
    return res.status(400).json({ error: "URL de YouTube inválida" });
  }

  if (!YouTubeValidator.validateWithYtdl(videoURL)) {
    return res.status(400).json({ error: "URL no válida para procesamiento" });
  }

  try {
    const videoInfo = await VideoProcessor.getVideoInfo(videoURL);
    console.log("✅ Información obtenida:", videoInfo.title);
    res.json(videoInfo);
  } catch (error) {
    console.error("❌ Error obteniendo información del video:", error.message);
    res.status(500).json({
      error: "Error al obtener información del video",
      details: error.message,
      suggestion: "Verifica que la URL sea correcta y el video esté disponible",
    });
  }
});

/**
 * Obtiene solo el título del video (endpoint ligero)
 */
app.post("/get-video-title", async (req, res) => {
  const { url: videoURL } = req.body;

  if (
    !videoURL ||
    !YouTubeValidator.isValidYouTubeURL(videoURL) ||
    !YouTubeValidator.validateWithYtdl(videoURL)
  ) {
    return res.status(400).json({ error: "URL inválida" });
  }

  try {
    const info = await ytdl.getInfo(videoURL);
    res.json({ title: info.videoDetails.title || "Título no disponible" });
  } catch (error) {
    console.error("❌ Error obteniendo título:", error);
    res.status(500).json({ error: "Error al obtener título del video" });
  }
});

/**
 * Descarga video en formato MP4
 */
app.post("/download-video", async (req, res) => {
  const { url: videoURL, quality = "highest" } = req.body;

  console.log("🎥 Descargando video:", { url: videoURL, quality });

  if (
    !videoURL ||
    !YouTubeValidator.isValidYouTubeURL(videoURL) ||
    !YouTubeValidator.validateWithYtdl(videoURL)
  ) {
    return res.status(400).json({ error: "URL inválida" });
  }

  try {
    const info = await ytdl.getInfo(videoURL);
    const title = sanitize(info.videoDetails.title || "video");
    const selectedFormat = VideoProcessor.selectVideoFormat(
      info.formats,
      quality
    );

    console.log(
      "📹 Formato seleccionado:",
      selectedFormat.qualityLabel || selectedFormat.quality
    );

    // Configurar headers
    res.setHeader("Content-Disposition", `attachment; filename="${title}.mp4"`);
    res.setHeader("Content-Type", "video/mp4");

    // Stream directo
    const videoStream = ytdl(videoURL, { format: selectedFormat });

    videoStream.on("error", (error) => {
      console.error("❌ Error en stream de video:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error durante la descarga" });
      }
    });

    await pipeline(videoStream, res);
  } catch (error) {
    console.error("❌ Error descargando video:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error al descargar el video",
        details: error.message,
      });
    }
  }
});

/**
 * Descarga y convierte audio a MP3
 */
app.post("/download-audio", async (req, res) => {
  const { url: videoURL, quality = "320" } = req.body;
  const bitrate = parseInt(quality.replace(/\D/g, "")) || 320;

  console.log("🎵 Descargando audio:", { url: videoURL, bitrate });

  if (
    !videoURL ||
    !YouTubeValidator.isValidYouTubeURL(videoURL) ||
    !YouTubeValidator.validateWithYtdl(videoURL)
  ) {
    return res.status(400).json({ error: "URL inválida" });
  }

  const tempAudioFile = fileManager.generateTempPath("webm");
  const outputMP3File = fileManager.generateTempPath("mp3");

  const cleanup = async () => {
    await Promise.all([
      fileManager.safeUnlink(tempAudioFile),
      fileManager.safeUnlink(outputMP3File),
    ]);
  };

  try {
    const info = await ytdl.getInfo(videoURL);
    const title = sanitize(info.videoDetails.title || "audio");

    console.log("🎵 Procesando audio de:", title);

    // Descargar audio
    const audioStream = ytdl(videoURL, {
      filter: "audioonly",
      quality: "highestaudio",
    });

    const writeStream = createWriteStream(tempAudioFile);

    // Usar pipeline para mejor manejo de errores
    await pipeline(audioStream, writeStream);

    console.log("⏳ Audio descargado, convirtiendo a MP3...");

    // Convertir a MP3
    await VideoProcessor.convertToMP3(tempAudioFile, outputMP3File, bitrate);

    // Enviar archivo
    res.setHeader("Content-Disposition", `attachment; filename="${title}.mp3"`);
    res.setHeader("Content-Type", "audio/mpeg");

    const readStream = createReadStream(outputMP3File);

    readStream.on("end", cleanup);
    readStream.on("error", async (error) => {
      console.error("❌ Error enviando archivo:", error);
      await cleanup();
    });

    await pipeline(readStream, res);
  } catch (error) {
    console.error("❌ Error en descarga de audio:", error);
    await cleanup();
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error al procesar solicitud de audio",
        details: error.message,
      });
    }
  }
});

// ===== MANEJO DE ERRORES =====
app.use((error, req, res, next) => {
  console.error("💥 Error no manejado:", error);
  res.status(500).json({
    error: "Error interno del servidor",
    ...(process.env.NODE_ENV === "development" && { details: error.message }),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado" });
});

// ===== INICIO DEL SERVIDOR =====
app.listen(PORT, async () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📁 Directorio público: ${fileManager.publicDir}`);
  console.log(`📁 Directorio temporal: ${fileManager.tempDir}`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || "development"}`);

  // Limpieza inicial
  await fileManager.cleanupOldFiles();
});

// Manejo graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🔄 Cerrando servidor...");
  await fileManager.cleanupOldFiles();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🔄 Cerrando servidor...");
  await fileManager.cleanupOldFiles();
  process.exit(0);
});
