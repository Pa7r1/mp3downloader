"use strict";

const SERVER = "http://localhost:3000";

async function waitForServer(timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${SERVER}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok) return true;
    } catch {
      /* sigue */
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case "detect": {
          const ready = await waitForServer(5000);
          if (!ready) {
            sendResponse({ ok: false, error: "Servidor offline" });
            return;
          }
          const res = await fetch(`${SERVER}/detect-url`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: msg.url }),
          });
          const data = await res.json();
          sendResponse({ ok: res.ok, data, error: data.error });
          break;
        }

        case "startDownload": {
          const ready = await waitForServer(5000);
          if (!ready) {
            sendResponse({
              ok: false,
              error: "Servidor offline — ejecutá npm run dev",
            });
            return;
          }
          const res = await fetch(`${SERVER}/start-download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: msg.url, format: msg.format }),
          });
          const data = await res.json();
          sendResponse({
            ok: res.ok,
            downloadId: data.downloadId,
            error: data.error,
          });
          break;
        }

        case "saveFile": {
          // Construir la URL del archivo y usar chrome.downloads con saveAs: true
          // para que aparezca el diálogo "¿dónde guardar?"
          const fileUrl = `${SERVER}/file/${msg.downloadId}?filename=${encodeURIComponent(msg.filename)}`;
          await chrome.downloads.download({
            url: fileUrl,
            filename: msg.filename,
            saveAs: true, // ← abre el diálogo de guardar
          });
          sendResponse({ ok: true });
          break;
        }

        case "serverStatus": {
          const ready = await waitForServer(3000);
          sendResponse({ ok: true, ready });
          break;
        }
      }
    } catch (e) {
      console.error("[YDL bg]", e);
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

// Arrancar: intentar conectar nativo o asumir servidor ya corriendo
chrome.runtime.onInstalled.addListener(() =>
  console.log("[YDL] Extensión instalada"),
);
chrome.runtime.onStartup.addListener(() => console.log("[YDL] Inicio"));
