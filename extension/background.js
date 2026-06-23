"use strict";

const SERVER = "http://localhost:3000";
const NATIVE_HOST = "com.pa7r1.ydl";

async function pingHealth(timeoutMs = 600) {
  try {
    const r = await fetch(`${SERVER}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await pingHealth(800)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function ensureServer() {
  if (await pingHealth(600)) return true;

  let port;
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
  } catch (e) {
    console.warn("[YDL] connectNative falló:", e.message);
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        /* ok */
      }
      resolve(ok);
    };

    port.onMessage.addListener((msg) => {
      if (msg?.status === "ready") {
        waitForServer(8000).then(finish);
      } else if (msg?.status === "error") {
        finish(false);
      }
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message;
      if (err) console.warn("[YDL] native disconnect:", err);
      if (!settled) waitForServer(5000).then(finish);
    });

    try {
      port.postMessage({ action: "start" });
    } catch (e) {
      console.warn("[YDL] postMessage falló:", e.message);
      finish(false);
      return;
    }

    setTimeout(() => {
      if (!settled) waitForServer(1).then(finish);
    }, 15000);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.action) {
        case "ensureServer": {
          const ready = await ensureServer();
          sendResponse({ ok: true, ready });
          break;
        }

        case "detect": {
          const ready = await ensureServer();
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
          const ready = await ensureServer();
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
          const fileUrl = `${SERVER}/file/${msg.downloadId}?filename=${encodeURIComponent(msg.filename)}`;
          await chrome.downloads.download({
            url: fileUrl,
            filename: msg.filename,
            saveAs: true,
          });
          sendResponse({ ok: true });
          break;
        }

        case "serverStatus": {
          const ready = await pingHealth(1500);
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

chrome.runtime.onInstalled.addListener(() =>
  console.log("[YDL] Extensión instalada"),
);
chrome.runtime.onStartup.addListener(() => console.log("[YDL] Inicio"));
