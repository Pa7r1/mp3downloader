/**
 * Native Messaging Host para YDL
 * Chrome lo lanza automáticamente cuando la extensión se conecta.
 * Lee mensajes en formato Native Messaging (4 bytes length + JSON)
 * y levanta el servidor Node si no está corriendo.
 */

import { spawn, exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ruta al server.js
const SERVER_DIR = path.join(__dirname, "..");
const SERVER_SCRIPT = path.join(SERVER_DIR, "server.js");
const SERVER_PORT = 3000;

let serverProcess = null;

//Native Messaging protocol

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(json.length, 0);
  process.stdout.write(buf);
  process.stdout.write(json);
}

function readMessage(callback) {
  process.stdin.once("readable", () => {
    const lenBuf = process.stdin.read(4);
    if (!lenBuf) return;
    const len = lenBuf.readUInt32LE(0);
    const msgBuf = process.stdin.read(len);
    if (!msgBuf) return;
    try {
      callback(JSON.parse(msgBuf.toString()));
    } catch {}
    readMessage(callback); // seguir leyendo
  });
}

//Server management

async function isServerRunning() {
  try {
    const { stdout } = await execAsync(
      `curl -s -o /dev/null -w "%{http_code}" http://localhost:${SERVER_PORT}/health`,
    );
    return stdout.trim() === "200";
  } catch {
    return false;
  }
}

async function startServer() {
  if (await isServerRunning()) {
    sendMessage({ status: "ready", msg: "servidor ya estaba corriendo" });
    return;
  }

  serverProcess = spawn("node", [SERVER_SCRIPT], {
    cwd: SERVER_DIR,
    detached: true,
    stdio: "ignore",
  });

  serverProcess.unref(); // no bloquear este proceso

  // Esperar a que levante
  let attempts = 0;
  const check = setInterval(async () => {
    attempts++;
    if (await isServerRunning()) {
      clearInterval(check);
      sendMessage({ status: "ready", msg: "servidor iniciado" });
    } else if (attempts > 15) {
      clearInterval(check);
      sendMessage({ status: "error", msg: "servidor no respondió" });
    }
  }, 600);
}

//Main

readMessage(async (msg) => {
  if (msg.action === "start") {
    await startServer();
  }
});

process.on("disconnect", () => process.exit(0));
