#!/usr/bin/env node
// Captura local de correo y WhatsApp para la versión dockerizada.
//
// Ningún mensaje sale de esta máquina: el worker entrega aquí en lugar de
// contactar a un proveedor externo. La bandeja sirve para leer enlaces de
// invitación, recuperación de contraseña y alertas de revisión.
//
//   POST   /api/messages   guarda un mensaje (idempotente por `id`)
//   GET    /api/messages   devuelve la bandeja en JSON
//   DELETE /api/messages   vacía la bandeja
//   GET    /health         estado del servicio
//   GET    /               bandeja legible en HTML
//
// Variables: PORT (8025), HOST (0.0.0.0), FIDES_SINK_STATE_FILE.

import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8025);
const HOST = process.env.HOST ?? "0.0.0.0";
const STATE_FILE =
  process.env.FIDES_SINK_STATE_FILE ??
  path.join(os.tmpdir(), "contratos-message-sink.json");
const MAX_MESSAGES = Number(process.env.FIDES_SINK_MAX_MESSAGES ?? 500);
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const CHANNEL_LABELS = {
  email: "Correo",
  whatsapp: "WhatsApp",
};

/** @type {Array<Record<string, unknown>>} */
let messages = [];
let writing = Promise.resolve();

function log(message) {
  process.stdout.write(`[sink] ${message}\n`);
}

async function loadState() {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) messages = parsed;
    else if (Array.isArray(parsed?.messages)) messages = parsed.messages;
    log(`estado restaurado: ${messages.length} mensaje(s)`);
  } catch {
    messages = [];
  }
}

function persist() {
  writing = writing.then(async () => {
    try {
      await mkdir(path.dirname(STATE_FILE), { recursive: true });
      const temporary = `${STATE_FILE}.tmp`;
      await writeFile(temporary, JSON.stringify({ messages }, null, 2), "utf8");
      await rename(temporary, STATE_FILE);
    } catch (error) {
      log(`no fue posible guardar el estado: ${error?.message ?? error}`);
    }
  });
  return writing;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("cuerpo demasiado grande"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(payload);
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(html);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function storeMessage(input) {
  const now = new Date().toISOString();
  const id = typeof input.id === "string" && input.id ? input.id : randomUUID();
  const message = {
    id,
    channel: input.channel === "whatsapp" ? "whatsapp" : "email",
    recipient: typeof input.recipient === "string" ? input.recipient : "",
    template: typeof input.template === "string" ? input.template : "",
    organizationId:
      typeof input.organizationId === "string" ? input.organizationId : null,
    payload:
      input.payload && typeof input.payload === "object" ? input.payload : {},
    createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
    receivedAt: now,
  };

  // Idempotencia: el worker puede reintentar la misma fila del outbox.
  const existing = messages.findIndex((item) => item.id === id);
  if (existing >= 0) messages[existing] = message;
  else messages.unshift(message);

  if (messages.length > MAX_MESSAGES) messages.length = MAX_MESSAGES;
  persist();
  return message;
}

function renderPayload(payload) {
  const text = JSON.stringify(payload, null, 2);
  if (!text || text === "{}") return "";
  return `<pre class="payload">${escapeHtml(text)}</pre>`;
}

function renderMessage(message) {
  const channel = CHANNEL_LABELS[message.channel] ?? message.channel;
  const stamp = message.receivedAt ?? message.createdAt ?? "";
  return `
    <article class="message">
      <header>
        <span class="badge badge-${escapeHtml(message.channel)}">${escapeHtml(channel)}</span>
        <span class="recipient">${escapeHtml(message.recipient || "(sin destinatario)")}</span>
        <time>${escapeHtml(stamp)}</time>
      </header>
      <p class="template">${escapeHtml(message.template || "(sin plantilla)")}</p>
      ${renderPayload(message.payload)}
    </article>`;
}

function renderInbox() {
  const body =
    messages.length === 0
      ? '<p class="empty">Todavía no hay mensajes capturados.</p>'
      : messages.map(renderMessage).join("\n");

  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="5" />
    <title>Bandeja local · Fides</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0; background: #FAFAF9; color: #0C0A09;
        font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      header.top { background: #1C1917; color: #FAFAF9; padding: 20px 24px; }
      header.top h1 { margin: 0; font-size: 20px; letter-spacing: .01em; }
      header.top p { margin: 6px 0 0; font-size: 13px; color: #D6D3D1; }
      main { max-width: 880px; margin: 0 auto; padding: 24px 16px 64px; }
      .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px;
        font-size: 13px; color: #44403C; }
      .message { background: #fff; border: 1px solid #E7E5E4; border-radius: 10px;
        padding: 14px 16px; margin-bottom: 12px; }
      .message header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
      .badge { font-size: 11px; text-transform: uppercase; letter-spacing: .08em;
        padding: 3px 8px; border-radius: 999px; font-weight: 600; }
      .badge-email { background: #1C1917; color: #FAFAF9; }
      .badge-whatsapp { background: #CA8A04; color: #1C1917; }
      .recipient { font-weight: 600; font-size: 14px; }
      time { margin-left: auto; font-size: 12px; color: #78716C; }
      .template { margin: 10px 0 0; font-size: 14px; color: #44403C; }
      .payload { margin: 10px 0 0; padding: 10px 12px; background: #F5F5F4;
        border-radius: 8px; font-size: 12px; overflow-x: auto; white-space: pre-wrap;
        word-break: break-word; }
      .empty { color: #78716C; font-size: 14px; }
      code { background: #F5F5F4; padding: 1px 5px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <header class="top">
      <h1>Bandeja local de mensajes</h1>
      <p>Captura local. Ningún mensaje sale de esta máquina.</p>
    </header>
    <main>
      <div class="toolbar">
        <span>${messages.length} mensaje(s)</span>
        <span>Se actualiza cada 5 s</span>
        <span>Vaciar: <code>curl -X DELETE http://localhost:${PORT}/api/messages</code></span>
      </div>
      ${body}
    </main>
  </body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const route = `${request.method} ${url.pathname}`;

  try {
    if (route === "GET /health") {
      sendJson(response, 200, { ok: true, messages: messages.length });
      return;
    }

    if (route === "GET /api/messages") {
      const channel = url.searchParams.get("channel");
      const recipient = url.searchParams.get("recipient");
      const filtered = messages.filter(
        (message) =>
          (!channel || message.channel === channel) &&
          (!recipient || message.recipient === recipient)
      );
      sendJson(response, 200, { ok: true, total: filtered.length, messages: filtered });
      return;
    }

    if (route === "POST /api/messages") {
      const raw = await readBody(request);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(response, 400, { ok: false, error: "JSON inválido" });
        return;
      }
      const stored = storeMessage(parsed ?? {});
      log(`${stored.channel} → ${stored.recipient} · ${stored.template}`);
      sendJson(response, 201, { ok: true, id: stored.id });
      return;
    }

    if (route === "DELETE /api/messages") {
      messages = [];
      await persist();
      sendJson(response, 200, { ok: true });
      return;
    }

    if (route === "GET /" || route === "GET /index.html") {
      sendHtml(response, 200, renderInbox());
      return;
    }

    sendJson(response, 404, { ok: false, error: "Ruta desconocida" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error?.message ?? "error interno" });
  }
});

function shutdown(signal) {
  log(`${signal} recibido, cerrando`);
  server.close(() => {
    persist().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

await loadState();
server.listen(PORT, HOST, () => {
  log(`escuchando en http://${HOST}:${PORT} · estado en ${STATE_FILE}`);
});
