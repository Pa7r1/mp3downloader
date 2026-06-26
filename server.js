import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import { spawn } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import sanitize from "sanitize-filename";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3100;
const TEMP_DIR = path.join(__dirname, "temp");
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_FILE_AGE_MS = 60 * 60 * 1000;
const COOKIES_FILE = `${process.env.HOME}/yt-cookies.txt`;

const sseClients = new Map();

function ytdlp(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let out = "",
      err = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", (d) => {
      const line = d.toString();
      err += line;
      if (line.includes("WARNING")) {
        process.stderr.write(d);
        return;
      }
      if (onProgress && line.includes("[download]")) {
        const pct = line.match(/(\d+\.?\d*)%/);
        const eta = line.match(/ETA\s+(\S+)/);
        const speed = line.match(/at\s+(\S+)/);
        const size = line.match(/of\s+(\S+)/);
        if (pct)
          onProgress({
            percent: parseFloat(pct[1]),
            eta: eta?.[1] || "",
            speed: speed?.[1] || "",
            size: size?.[1] || "",
          });
      }
    });
    proc.on("close", (code) => {
      if (code === 0) return resolve(out);
      const realErrors = err
        .split("\n")
        .filter((l) => l.includes("ERROR:") && !l.includes("WARNING"))
        .join("\n");
      reject(new Error(realErrors || err || `yt-dlp exit ${code}`));
    });
    proc.on("error", (e) =>
      reject(new Error(`yt-dlp no encontrado: ${e.message}`)),
    );
  });
}

function sendSSE(downloadId, event, data) {
  const client = sseClients.get(downloadId);
  if (client && !client.writableEnded)
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function pickSize(f) {
  return f.filesize || f.filesize_approx || 0;
}

function estimateSizes(formats) {
  if (!Array.isArray(formats)) return { audio: 0, video: 0 };

  const audioOnly = formats.filter(
    (f) =>
      f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"),
  );
  const bestAudio =
    audioOnly
      .filter((f) => f.ext === "m4a")
      .sort((a, b) => pickSize(b) - pickSize(a))[0] ||
    audioOnly.sort((a, b) => pickSize(b) - pickSize(a))[0];

  const videoOnly = formats.filter(
    (f) =>
      f.vcodec && f.vcodec !== "none" && (!f.acodec || f.acodec === "none"),
  );
  const bestVideo =
    videoOnly
      .filter((f) => f.ext === "mp4")
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0] ||
    videoOnly.sort((a, b) => (b.height || 0) - (a.height || 0))[0];

  const audioBytes = bestAudio ? pickSize(bestAudio) : 0;
  const videoBytes = bestVideo ? pickSize(bestVideo) : 0;
  return {
    audio: audioBytes,
    video: audioBytes + videoBytes,
  };
}

async function getVideoInfo(url) {
  const raw = await ytdlp([
    url,
    "--dump-json",
    "--no-playlist",
    "--cookies",
    COOKIES_FILE,
    "--js-runtimes",
    `node:${process.execPath}`,
  ]);
  const info = JSON.parse(raw);
  return {
    videoId: info.id,
    title: info.title || "Sin título",
    duration: formatDuration(info.duration ?? 0),
    channel: info.uploader || info.channel || "Desconocido",
    views: info.view_count ?? 0,
    thumbnail: info.thumbnail || "",
    sizes: estimateSizes(info.formats),
  };
}

async function getPlaylistInfo(url) {
  const raw = await ytdlp([
    url,
    "--dump-json",
    "--flat-playlist",
    "--cookies",
    COOKIES_FILE,
    "--js-runtimes",
    `node:${process.execPath}`,
  ]);
  const entries = raw
    .trim()
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  if (!entries.length) throw new Error("Playlist vacía o inaccesible");
  const first = entries[0];
  return {
    id: first.playlist_id || first.id,
    title: first.playlist_title || first.title || "Playlist",
    channel: first.uploader || first.channel || "Desconocido",
    videoCount: entries.length,
    thumbnail: first.thumbnail || "",
    videos: entries.map((e) => ({
      id: e.id,
      title: e.title || "Sin título",
      url: `https://www.youtube.com/watch?v=${e.id}`,
      duration: formatDuration(e.duration),
      thumbnail: e.thumbnail || "",
    })),
  };
}

async function downloadWithProgress(url, format, downloadId) {
  const info = await getVideoInfo(url);
  const safeTitle = sanitize(info.title || "descarga");
  sendSSE(downloadId, "info", {
    title: info.title,
    phase: "Preparando descarga...",
  });

  const tmpBase = path.join(TEMP_DIR, `${downloadId}`);
  let tmpPath, filename;

  if (format === "audio") {
    filename = `${safeTitle}.mp3`;
    tmpPath = `${tmpBase}.mp3`;
    sendSSE(downloadId, "progress", {
      percent: 0,
      phase: "Descargando audio...",
    });
    await ytdlp(
      [
        url,
        "-x",
        "--audio-format",
        "mp3",
        "--audio-quality",
        "0",
        "--cookies",
        COOKIES_FILE,
        "-o",
        `${tmpBase}.%(ext)s`,
        "--no-playlist",
        "--js-runtimes",
        `node:${process.execPath}`,
      ],
      (p) =>
        sendSSE(downloadId, "progress", {
          ...p,
          phase: "Descargando audio...",
        }),
    );
    if (!existsSync(tmpPath)) {
      const files = await fs.readdir(TEMP_DIR);
      const found = files.find((f) => f.startsWith(downloadId));
      if (found) tmpPath = path.join(TEMP_DIR, found);
    }
  } else {
    filename = `${safeTitle}.mp4`;
    tmpPath = `${tmpBase}.mp4`;
    sendSSE(downloadId, "progress", {
      percent: 0,
      phase: "Descargando video...",
    });
    await ytdlp(
      [
        url,
        "-f",
        "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best",
        "--merge-output-format",
        "mp4",
        "--cookies",
        COOKIES_FILE,
        "-o",
        tmpPath,
        "--no-playlist",
        "--js-runtimes",
        `node:${process.execPath}`,
      ],
      (p) =>
        sendSSE(downloadId, "progress", {
          ...p,
          phase: "Descargando video...",
        }),
    );
  }

  sendSSE(downloadId, "progress", { percent: 99, phase: "Finalizando..." });
  if (!existsSync(tmpPath)) throw new Error("El archivo no se generó");
  const stats = await fs.stat(tmpPath);
  sendSSE(downloadId, "ready", { downloadId, filename, size: stats.size });
}

function formatDuration(secs) {
  if (!secs) return "Desconocido";
  const h = Math.floor(secs / 3600),
    m = Math.floor((secs % 3600) / 60),
    s = secs % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

async function pipeAndClean(filePath, res) {
  return new Promise((resolve, reject) => {
    if (!existsSync(filePath))
      return reject(new Error("Archivo no encontrado"));
    const stream = createReadStream(filePath);
    stream.pipe(res);
    stream.on("end", async () => {
      await fs.unlink(filePath).catch(() => {});
      resolve();
    });
    stream.on("error", async (err) => {
      await fs.unlink(filePath).catch(() => {});
      reject(err);
    });
  });
}

function isYouTubeURL(url) {
  try {
    const { hostname } = new URL(url);
    return hostname.includes("youtube.com") || hostname.includes("youtu.be");
  } catch {
    return false;
  }
}

function isPlaylistURL(url) {
  try {
    const u = new URL(url);
    return u.searchParams.has("list") && !u.searchParams.has("v");
  } catch {
    return false;
  }
}

async function cleanupOldFiles() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    const now = Date.now();
    await Promise.all(
      files.map(async (f) => {
        const p = path.join(TEMP_DIR, f);
        const { mtimeMs } = await fs.stat(p).catch(() => ({ mtimeMs: now }));
        if (now - mtimeMs > MAX_FILE_AGE_MS) await fs.unlink(p).catch(() => {});
      }),
    );
  } catch {
    /* ok */
  }
}

const app = express();
app.use(
  cors({ origin: (origin, cb) => cb(null, true), methods: ["GET", "POST"] }),
);
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Reenvía los rechazos de los handlers async al middleware de error.
// Necesario porque Express 4 no lo hace solo (a diferencia de Express 5).
const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

app.post("/detect-url", asyncH(async (req, res) => {
  const { url } = req.body;
  if (!url || !isYouTubeURL(url))
    return res.status(400).json({ error: "URL inválida" });
  if (isPlaylistURL(url)) {
    const data = await getPlaylistInfo(url);
    res.json({ type: "playlist", data });
  } else {
    const data = await getVideoInfo(url);
    res.json({ type: "video", data });
  }
}));

app.post("/get-video-info", asyncH(async (req, res) => {
  const { url } = req.body;
  if (!url || !isYouTubeURL(url))
    return res.status(400).json({ error: "URL inválida" });
  res.json(await getVideoInfo(url));
}));

app.post("/get-video-title", asyncH(async (req, res) => {
  const { url } = req.body;
  if (!url || !isYouTubeURL(url))
    return res.status(400).json({ error: "URL inválida" });
  const { title } = await getVideoInfo(url);
  res.json({ title });
}));

app.get("/progress/:downloadId", (req, res) => {
  const { downloadId } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  sseClients.set(downloadId, res);
  req.on("close", () => sseClients.delete(downloadId));
});

app.post("/start-download", async (req, res) => {
  const { url, format = "audio" } = req.body;
  if (!url || !isYouTubeURL(url))
    return res.status(400).json({ error: "URL inválida" });
  const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  res.json({ downloadId });
  downloadWithProgress(url, format, downloadId).catch((err) => {
    console.error("❌", err.message);
    sendSSE(downloadId, "error", { message: err.message });
  });
});

app.get("/file/:downloadId", asyncH(async (req, res) => {
  const { downloadId } = req.params;
  const { filename } = req.query;
  const files = await fs.readdir(TEMP_DIR).catch(() => []);
  const found = files.find((f) => f.startsWith(downloadId));
  if (!found)
    return res.status(404).json({ error: "Archivo no encontrado o expirado" });
  const filePath = path.join(TEMP_DIR, found);
  const ext = path.extname(found).slice(1);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename || found}"`,
  );
  res.setHeader("Content-Type", ext === "mp3" ? "audio/mpeg" : "video/mp4");
  await pipeAndClean(filePath, res);
}));

app.use((err, _req, res, _next) => {
  console.error("❌", err.message);
  if (!res.headersSent) res.status(500).json({ error: err.message });
});
app.use((_req, res) => res.status(404).json({ error: "No encontrado" }));

await fs.mkdir(TEMP_DIR, { recursive: true });
await fs.mkdir(PUBLIC_DIR, { recursive: true });
setInterval(cleanupOldFiles, 30 * 60 * 1000);

app.listen(PORT, async () => {
  console.log(`🚀 http://localhost:${PORT}`);
  try {
    const { stdout } = await execAsync("yt-dlp --version");
    console.log(`✅ yt-dlp ${stdout.trim()}`);
  } catch {
    console.error("⚠️  yt-dlp no instalado");
  }
  await cleanupOldFiles();
});

for (const sig of ["SIGTERM", "SIGINT"])
  process.on(sig, async () => {
    await cleanupOldFiles();
    process.exit(0);
  });
process.on("uncaughtException", (err) =>
  console.error("❌ uncaughtException:", err.message),
);
process.on("unhandledRejection", (err) =>
  console.error("❌ unhandledRejection:", err),
);
