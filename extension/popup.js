"use strict";

const SERVER = "http://localhost:3100";
let currentURL = null;
let selectedFormat = "audio";
let isDownloading = false;
let currentEventSource = null;

// ── Helpers UI ────────────────────────────────────────────────────────────────

function $(id) {
  return document.getElementById(id);
}

function formatBytes(n) {
  if (!n) return "—";
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

function setFooter(msg, type = "") {
  const el = $("footer");
  el.className = type;
  el.innerHTML =
    type === "loading" ? `<div class="spinner"></div><span>${msg}</span>` : msg;
}

function setServerStatus(online) {
  $("srv-dot").className = "dot " + (online ? "online" : "offline");
  $("srv-label").textContent = online ? "servidor activo" : "servidor offline";
}

function showProgress(visible) {
  $("progress-section").classList.toggle("visible", visible);
}

function updateProgress({
  percent = 0,
  phase = "",
  speed = "",
  eta = "",
  size = "",
}) {
  $("prog-phase").textContent = phase;
  $("prog-pct").textContent = Math.round(percent) + "%";
  $("prog-fill").style.width = percent + "%";
  $("prog-speed").textContent = speed ? `⚡ ${speed}` : "";
  $("prog-eta").textContent = eta ? `⏱ ${eta}` : "";
  $("prog-size").textContent = size ? `📦 ${size}` : "";
  if (percent >= 99) $("prog-fill").classList.add("done");
  else $("prog-fill").classList.remove("done");
}

function setBtn(state) {
  const btn = $("dl-btn");
  const icons = {
    ready: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 4v-2h14v2H5z"/></svg>`,
    loading: `<div class="spinner" style="border-color:#555;border-top-color:#fff"></div>`,
    success: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    error: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
  };
  const labels = {
    ready: "Descargar",
    loading: "Descargando...",
    success: "¡Descargado!",
    error: "Reintentar",
  };
  btn.className =
    state === "success" ? "success" : state === "error" ? "error-state" : "";
  btn.disabled = state === "loading";
  btn.innerHTML = `${icons[state]} ${labels[state]}`;
}

// ── Format ────────────────────────────────────────────────────────────────────

function setFormat(fmt) {
  selectedFormat = fmt;
  $("fmt-mp3").classList.toggle("active", fmt === "audio");
  $("fmt-mp4").classList.toggle("active", fmt === "video");
}

$("fmt-mp3").addEventListener("click", () => setFormat("audio"));
$("fmt-mp4").addEventListener("click", () => setFormat("video"));

// ── Download flow ─────────────────────────────────────────────────────────────

$("dl-btn").addEventListener("click", startDownload);

async function startDownload() {
  if (isDownloading || !currentURL) return;
  isDownloading = true;
  setBtn("loading");
  showProgress(true);
  updateProgress({ percent: 0, phase: "Iniciando..." });
  setFooter("Conectando con el servidor...", "loading");

  try {
    // 1. Pedir al background que inicie la descarga
    const res = await new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { action: "startDownload", url: currentURL, format: selectedFormat },
        resolve,
      ),
    );
    void chrome.runtime.lastError;

    if (!res?.ok) throw new Error(res?.error || "Error al iniciar descarga");

    const { downloadId } = res;

    // 2. Escuchar progreso por SSE
    await listenProgress(downloadId);
  } catch (err) {
    console.error("[YDL popup]", err);
    isDownloading = false;
    setBtn("error");
    showProgress(false);
    setFooter("Error: " + err.message, "error");
    setTimeout(() => {
      setBtn("ready");
      setFooter("Listo para descargar");
    }, 5000);
  }
}

function listenProgress(downloadId) {
  return new Promise((resolve, reject) => {
    // SSE desde el servidor
    const es = new EventSource(`${SERVER}/progress/${downloadId}`);
    currentEventSource = es;

    es.addEventListener("info", (e) => {
      const d = JSON.parse(e.data);
      setFooter(`Procesando: ${d.title?.slice(0, 40) || ""}...`, "loading");
    });

    es.addEventListener("progress", (e) => {
      const d = JSON.parse(e.data);
      updateProgress(d);
      setFooter(d.phase || "Descargando...", "loading");
    });

    es.addEventListener("ready", async (e) => {
      es.close();
      const { downloadId: dlId, filename, size } = JSON.parse(e.data);
      updateProgress({ percent: 100, phase: "¡Listo! Guardando archivo..." });

      // 3. Pedir al background que descargue el archivo (abre el diálogo "guardar como")
      const res = await new Promise((resolve2) =>
        chrome.runtime.sendMessage(
          { action: "saveFile", downloadId: dlId, filename, size },
          resolve2,
        ),
      );
      void chrome.runtime.lastError;

      isDownloading = false;
      currentEventSource = null;

      if (res?.ok) {
        setBtn("success");
        setFooter(`✓ Guardado: ${filename}`, "success");
        setTimeout(() => {
          setBtn("ready");
          setFooter("Listo para descargar");
          showProgress(false);
        }, 5000);
        resolve();
      } else {
        reject(new Error(res?.error || "Error al guardar"));
      }
    });

    es.addEventListener("error", (e) => {
      es.close();
      currentEventSource = null;
      isDownloading = false;
      let msg = "Error en la descarga";
      try {
        msg = JSON.parse(e.data).message;
      } catch {
        /* ok */
      }
      reject(new Error(msg));
    });

    es.onerror = () => {
      // Solo rechazar si aún no terminó
      if (currentEventSource === es) {
        es.close();
        currentEventSource = null;
        isDownloading = false;
        reject(new Error("Se perdió la conexión con el servidor"));
      }
    };
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function pingServer(timeoutMs = 1500) {
  try {
    const r = await fetch(`${SERVER}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServerViaBackground() {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ action: "ensureServer" }, (res) => {
      void chrome.runtime.lastError;
      resolve(!!res?.ready);
    }),
  );
}

async function init() {
  let online = await pingServer(1500);

  if (!online) {
    setServerStatus(false);
    setFooter("Arrancando servidor...", "loading");
    online = await ensureServerViaBackground();
  }

  setServerStatus(online);
  if (!online) {
    setFooter("Servidor offline — ejecutá npm run dev", "error");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const url = tab.url;
  const isYT = url.includes("youtube.com/watch") || url.includes("youtu.be/");

  if (!isYT) {
    setFooter("Navegá a un video de YouTube primero");
    return;
  }

  currentURL = url;
  setFooter("Cargando información del video...", "loading");

  try {
    const res = await fetch(`${SERVER}/detect-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await res.json();
    const data = result.data;

    $("empty-state").style.display = "none";
    $("video-card").style.display = "flex";
    $("v-thumb").src = data.thumbnail || "";
    $("v-title").textContent = data.title || "Sin título";
    $("v-channel").textContent = data.channel || "";
    $("v-duration").textContent = data.videoCount
      ? `${data.videoCount} videos`
      : data.duration || "";
    $("v-views").textContent = data.views
      ? `${data.views.toLocaleString("es-AR")} vistas`
      : "";

    const sizes = data.sizes || { audio: 0, video: 0 };
    $("fmt-mp3-size").textContent = formatBytes(sizes.audio);
    $("fmt-mp4-size").textContent = formatBytes(sizes.video);

    $("dl-btn").disabled = false;

    setFooter(
      result.type === "playlist"
        ? `Playlist · ${data.videoCount} videos`
        : "Listo para descargar",
    );
  } catch (err) {
    setFooter("No se pudo cargar el video: " + err.message, "error");
  }
}

init();
