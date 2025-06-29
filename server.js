import express from "express";
import cors from "cors";
import ytdl from "ytdl-core";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import sanitize from "sanitize-filename";
import { execSync } from "child_process";

// Configurar FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath.path);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Crear directorios necesarios
const tempDir = path.join(__dirname, "temp");
const ffmpegDir = path.join(__dirname, "ffmpeg");

if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
if (!fs.existsSync(ffmpegDir)) fs.mkdirSync(ffmpegDir);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Ruta para obtener información del video
app.post("/get-video-info", async (req, res) => {
  const videoURL = req.body.url;

  if (!videoURL || !ytdl.validateURL(videoURL)) {
    return res.status(400).send("URL inválida");
  }

  try {
    const info = await ytdl.getInfo(videoURL);
    const videoId = info.videoDetails.videoId;

    const videoInfo = {
      videoId,
      title: info.videoDetails.title,
      duration: formatDuration(info.videoDetails.lengthSeconds),
      channel: info.videoDetails.author.name,
      views: parseInt(info.videoDetails.viewCount),
      thumbnail: info.videoDetails.thumbnails[0].url,
    };

    res.json(videoInfo);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al obtener información del video");
  }
});

// Ruta para obtener solo el título del video
app.post("/get-video-title", async (req, res) => {
  const videoURL = req.body.url;

  if (!videoURL || !ytdl.validateURL(videoURL)) {
    return res.status(400).send("URL inválida");
  }

  try {
    const info = await ytdl.getInfo(videoURL);
    res.json({ title: info.videoDetails.title });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al obtener título del video");
  }
});

// Descargar video
app.post("/download-video", async (req, res) => {
  const videoURL = req.body.url;
  const quality = req.body.quality || "highest";

  if (!videoURL || !ytdl.validateURL(videoURL)) {
    return res.status(400).send("URL inválida");
  }

  try {
    const info = await ytdl.getInfo(videoURL);
    const title = sanitize(info.videoDetails.title);

    // Configurar calidad
    let format;
    if (quality === "highest") {
      format = ytdl.chooseFormat(info.formats, {
        quality: "highestvideo",
        filter: (format) => format.hasVideo && format.hasAudio,
      });
    } else {
      format = ytdl.chooseFormat(info.formats, {
        quality: quality,
        filter: (format) => format.hasVideo && format.hasAudio,
      });
    }

    if (!format) {
      throw new Error("No se encontró formato con audio y video");
    }

    // Configurar headers
    res.setHeader("Content-Disposition", `attachment; filename="${title}.mp4"`);
    res.setHeader("Content-Type", "video/mp4");

    // Descargar y enviar
    ytdl(videoURL, { format })
      .on("progress", (chunkLength, downloaded, total) => {})
      .pipe(res);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error al descargar el video: " + error.message);
  }
});

// Descargar audio (convertido a MP3)
app.post("/download-audio", async (req, res) => {
  console.log(">> POST /download-audio");

  const videoURL = req.body.url;
  let bitrate = parseInt(req.body.quality?.replace(/\D/g, "")) || 320;

  console.log("Parámetros recibidos:", { videoURL, bitrate });

  if (!videoURL) {
    console.error("Error: URL no proporcionada");
    return res.status(400).send("URL no proporcionada");
  }

  if (!ytdl.validateURL(videoURL)) {
    console.error("Error: URL de YouTube inválida");
    return res.status(400).send("URL de YouTube inválida");
  }

  try {
    console.log("Obteniendo información del video...");
    const info = await ytdl.getInfo(videoURL);
    const title = sanitize(info.videoDetails.title);
    const tempFile = path.join(
      tempDir,
      `${Date.now()}_${title.replace(/\s+/g, "_")}.webm`
    );
    const outputFile = path.join(
      tempDir,
      `${Date.now()}_${title.replace(/\s+/g, "_")}.mp3`
    );

    console.log(`Título del audio: "${title}"`);
    console.log(`Archivos temporales: ${tempFile}, ${outputFile}`);

    // Descargar audio
    const audioStream = ytdl(videoURL, {
      filter: "audioonly",
      quality: "highestaudio",
    });

    // Guardar en archivo temporal
    const writeStream = fs.createWriteStream(tempFile);
    audioStream.pipe(writeStream);

    writeStream.on("finish", async () => {
      try {
        console.log("Audio descargado. Iniciando conversión a MP3...");

        // Convertir a MP3 usando FFmpeg
        await new Promise((resolve, reject) => {
          ffmpeg(tempFile)
            .outputOptions([
              "-codec:a",
              "libmp3lame",
              "-b:a",
              `${bitrate}k`,
              "-ac",
              "2",
              "-ar",
              "44100",
            ])
            .on("end", () => {
              console.log("Conversión completada");
              resolve();
            })
            .on("error", (err) => {
              console.error("Error en FFmpeg:", err);
              reject(err);
            })
            .on("progress", (progress) => {
              console.log(`Progreso conversión: ${progress.percent}%`);
            })
            .save(outputFile);
        });

        // Enviar el archivo convertido
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${title}.mp3"`
        );
        res.setHeader("Content-Type", "audio/mpeg");

        const readStream = fs.createReadStream(outputFile);
        readStream.pipe(res);

        readStream.on("end", () => {
          console.log("Archivo enviado. Limpiando temporales...");
          // Limpiar archivos temporales
          fs.unlink(tempFile, () => {});
          fs.unlink(outputFile, () => {});
        });
      } catch (convertError) {
        console.error("Error en conversión:", convertError);
        res.status(500).json({
          error: "Error al convertir a MP3",
          details: convertError.message,
        });

        // Limpiar archivos temporales en caso de error
        if (fs.existsSync(tempFile)) fs.unlink(tempFile, () => {});
        if (fs.existsSync(outputFile)) fs.unlink(outputFile, () => {});
      }
    });

    writeStream.on("error", (err) => {
      console.error("Error al descargar audio:", err);
      res.status(500).json({
        error: "Error al descargar audio",
        details: err.message,
      });
      if (fs.existsSync(tempFile)) fs.unlink(tempFile, () => {});
    });
  } catch (error) {
    console.error("Error en /download-audio:", error);
    res.status(500).json({
      error: "Error al procesar la solicitud de audio",
      details: error.message,
    });
  }
});

// Función para formatear duración en segundos a formato MM:SS
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds < 10 ? "0" : ""}${remainingSeconds}`;
}

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
