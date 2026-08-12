#!/usr/bin/env node
// Doble local controlado del proveedor de revisión asistida.
//
// No es un proveedor real y nunca contacta a uno: produce un informe
// determinista a partir de los metadatos de la evidencia sintética.
// Sólo recomienda; jamás acepta, cancela ni crea nada. La decisión siempre
// queda en una persona con rol Revisor.
//
//   POST /analizar  { reference, expectedStatement, organization,
//                     evidence: [{ kind, fileName, byteSize, sha256 }] }
//   GET  /health
//   GET  /          descripción de los resultados disponibles
//
// Resultado según el nombre de archivo de la evidencia sintética:
//   contiene `falla`   → HTTP 503 y { status: "failed" }
//   contiene `repetir` → recomendación `repeat`
//   contiene `dudoso`  → recomendación `inconclusive`
//   en cualquier otro caso → recomendación `accept`
//
// Variables: PORT (8030), HOST (0.0.0.0).

import { createServer } from "node:http";
import process from "node:process";

const PORT = Number(process.env.PORT ?? 8030);
const HOST = process.env.HOST ?? "0.0.0.0";
const MODEL = process.env.FIDES_AI_MODEL ?? "doble-local-revision";
const CONFIGURATION_VERSION = process.env.FIDES_AI_CONFIG ?? "local-1";
const MAX_BODY_BYTES = 1024 * 1024;

function log(message) {
  process.stdout.write(`[ai-double] ${message}\n`);
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
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
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function outcomeFor(evidence) {
  const names = evidence
    .map((item) => normalize(`${item?.fileName ?? ""} ${item?.kind ?? ""}`))
    .join(" ");
  if (names.includes("falla")) return "failed";
  if (names.includes("repetir")) return "repeat";
  if (names.includes("dudoso")) return "inconclusive";
  return "accept";
}

function buildReport(outcome, input) {
  const expected = String(input.expectedStatement ?? "").trim();
  const hasVideo = input.evidence.some((item) => item?.kind === "video");
  const base = {
    model: MODEL,
    configurationVersion: CONFIGURATION_VERSION,
    expectedStatement: expected,
    limitations:
      "Doble local determinista sobre metadatos sintéticos. No analiza audio, " +
      "video ni identidad, y no determina suficiencia jurídica.",
  };

  if (outcome === "repeat") {
    return {
      ...base,
      status: "completed",
      recommendation: "repeat",
      confidence: 0.62,
      transcript: expected ? expected.split(/\s+/).slice(0, 6).join(" ") : "",
      findings: [
        {
          code: "declaracion_incompleta",
          severity: "alta",
          detail:
            "La transcripción no reproduce la declaración esperada completa; " +
            "faltan enunciados finales.",
        },
        {
          code: hasVideo ? "video_corto" : "evidencia_insuficiente",
          severity: "media",
          detail: hasVideo
            ? "El video sintético es más corto que la declaración esperada."
            : "No se recibió video guiado para contrastar la declaración.",
        },
      ],
    };
  }

  if (outcome === "inconclusive") {
    return {
      ...base,
      status: "completed",
      recommendation: "inconclusive",
      confidence: 0.41,
      transcript: expected ? `${expected.slice(0, Math.ceil(expected.length / 2))}…` : "",
      findings: [
        {
          code: "audio_poco_claro",
          severity: "media",
          detail:
            "La transcripción quedó parcial; no hay elementos suficientes para " +
            "recomendar aceptar o repetir. Requiere lectura humana.",
        },
      ],
    };
  }

  return {
    ...base,
    status: "completed",
    recommendation: "accept",
    confidence: 0.94,
    transcript: expected,
    findings: [
      {
        code: "declaracion_coincide",
        severity: "informativa",
        detail: "La transcripción coincide con la declaración esperada.",
      },
    ],
  };
}

function renderDescription() {
  return `<!doctype html>
<html lang="es-MX">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Doble local de revisión asistida</title>
    <style>
      body { margin: 0; background: #FAFAF9; color: #0C0A09;
        font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
      header { background: #1C1917; color: #FAFAF9; padding: 20px 24px; }
      header h1 { margin: 0; font-size: 20px; }
      header p { margin: 6px 0 0; font-size: 13px; color: #D6D3D1; }
      main { max-width: 760px; margin: 0 auto; padding: 24px 16px 64px; font-size: 14px; }
      table { border-collapse: collapse; width: 100%; margin-top: 12px; background: #fff; }
      th, td { border: 1px solid #E7E5E4; padding: 8px 10px; text-align: left; }
      th { background: #F5F5F4; font-size: 13px; }
      code { background: #F5F5F4; padding: 1px 5px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <header>
      <h1>Doble local de revisión asistida</h1>
      <p>Proceso local determinista. No es un proveedor real y sólo recomienda.</p>
    </header>
    <main>
      <p>
        <code>POST /analizar</code> recibe <code>{ reference, expectedStatement,
        organization, evidence: [{ kind, fileName, byteSize, sha256 }] }</code> y
        devuelve un informe. El resultado se elige por el nombre de archivo de la
        evidencia sintética.
      </p>
      <table>
        <tr><th>Nombre de archivo contiene</th><th>Resultado</th></tr>
        <tr><td><code>falla</code></td><td>HTTP 503 · <code>status: "failed"</code></td></tr>
        <tr><td><code>repetir</code></td><td>recomendación <code>repeat</code></td></tr>
        <tr><td><code>dudoso</code></td><td>recomendación <code>inconclusive</code></td></tr>
        <tr><td>cualquier otro</td><td>recomendación <code>accept</code></td></tr>
      </table>
      <p>
        El informe nunca acepta, cancela ni crea nada; una persona con rol Revisor
        decide. Con falla o resultado no concluyente el Contrato permanece
        <code>A revisión</code>.
      </p>
    </main>
  </body>
</html>`;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const route = `${request.method} ${url.pathname}`;

  try {
    if (route === "GET /health") {
      sendJson(response, 200, { ok: true, model: MODEL });
      return;
    }

    if (route === "GET /" || route === "GET /index.html") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(renderDescription());
      return;
    }

    if (route === "POST /analizar") {
      const raw = await readBody(request);
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        sendJson(response, 400, { ok: false, error: "JSON inválido" });
        return;
      }

      const input = {
        reference: typeof parsed?.reference === "string" ? parsed.reference : "",
        organization: typeof parsed?.organization === "string" ? parsed.organization : "",
        expectedStatement:
          typeof parsed?.expectedStatement === "string" ? parsed.expectedStatement : "",
        evidence: Array.isArray(parsed?.evidence) ? parsed.evidence : [],
      };

      const outcome = outcomeFor(input.evidence);
      log(`${input.reference || "(sin referencia)"} → ${outcome}`);

      if (outcome === "failed") {
        sendJson(response, 503, {
          status: "failed",
          model: MODEL,
          configurationVersion: CONFIGURATION_VERSION,
          transcript: "",
          expectedStatement: input.expectedStatement,
          findings: [],
          confidence: null,
          limitations:
            "El doble local simuló una falla del proveedor. No hay informe y " +
            "no se recomienda nada.",
          recommendation: null,
          error: "proveedor no disponible",
        });
        return;
      }

      sendJson(response, 200, buildReport(outcome, input));
      return;
    }

    sendJson(response, 404, { ok: false, error: "Ruta desconocida" });
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error?.message ?? "error interno" });
  }
});

function shutdown(signal) {
  log(`${signal} recibido, cerrando`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

server.listen(PORT, HOST, () => {
  log(`escuchando en http://${HOST}:${PORT}`);
});
