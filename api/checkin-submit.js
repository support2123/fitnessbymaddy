const { query, insert, uploadFile } = require("./lib/supabase");
const { sendText, maskPhone } = require("./lib/whatsapp");
const { needsEscalation, corsHeaders, validateToken } = require("./lib/utils");

const MADDY_PHONE = process.env.MADDY_PHONE;
const BASE_URL = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "https://fitnessbymaddy.com";

/**
 * POST /api/checkin-submit
 * Accepts weekly check-in form submission (multipart/form-data or JSON).
 * Query params: t (token), c (client_id), w (week_no)
 */
module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: "Method not allowed" });
  }

  try {
    // ── Validate token ──────────────────────────────────────────────
    const token = req.query.t;
    if (!token || !validateToken(token)) {
      console.warn("[checkin-submit] Invalid or expired token");
      return res
        .status(403)
        .json({ error: "Invalid or expired check-in link. Please request a new one." });
    }

    // ── Parse body ──────────────────────────────────────────────────
    const {
      client_id,
      week_no,
      weight,
      waist,
      compliance_score,
      energy,
      issues,
      photos, // base64-encoded array when JSON; file buffers when multipart
    } = await parseBody(req);

    if (!client_id || !week_no) {
      return res
        .status(400)
        .json({ error: "client_id and week_no are required" });
    }

    const weekNum = parseInt(week_no, 10);
    const complianceNum = clamp(parseInt(compliance_score, 10) || 0, 1, 10);
    const energyNum = clamp(parseInt(energy, 10) || 0, 1, 10);

    console.log(
      `[checkin-submit] client=${client_id} week=${weekNum}`
    );

    // ── Upload photos (up to 3) ─────────────────────────────────────
    const photoUrls = [];
    const photoArray = Array.isArray(photos) ? photos.slice(0, 3) : [];

    for (let i = 0; i < photoArray.length; i++) {
      const photo = photoArray[i];
      if (!photo || !photo.buffer) continue;

      const storagePath = `clients/${client_id}/checkin_w${weekNum}_photo${i + 1}.jpg`;
      try {
        await uploadFile(
          "checkin-photos",
          storagePath,
          photo.buffer,
          photo.contentType || "image/jpeg"
        );
        photoUrls.push(storagePath);
        console.log(`[checkin-submit] Uploaded photo ${i + 1} for client=${client_id}`);
      } catch (uploadErr) {
        console.error(
          `[checkin-submit] Photo upload failed (${i + 1}):`,
          uploadErr.message
        );
        // Continue -- partial photo upload is acceptable
      }
    }

    // ── Insert check-in record ──────────────────────────────────────
    const checkinData = {
      client_id,
      week_no: weekNum,
      weight: weight ? parseFloat(weight) : null,
      waist: waist ? parseFloat(waist) : null,
      compliance_score: complianceNum,
      energy: energyNum,
      issues: issues || null,
      photos_urls: photoUrls.length > 0 ? photoUrls : null,
      form_submitted_at: new Date().toISOString(),
    };

    const [inserted] = await insert("checkins", checkinData);
    console.log(
      `[checkin-submit] Check-in saved id=${inserted?.id} client=${client_id} week=${weekNum}`
    );

    // ── Escalation check ────────────────────────────────────────────
    if (issues && needsEscalation(issues)) {
      console.warn(
        `[checkin-submit] ESCALATION triggered for client=${client_id} week=${weekNum}`
      );
      try {
        await sendText(
          MADDY_PHONE,
          `🚨 ESCALATION — Client ${client_id} (week ${weekNum}) check-in flagged.\n\nIssue: ${issues.slice(0, 300)}`
        );
      } catch (notifyErr) {
        console.error(
          "[checkin-submit] Failed to notify Maddy for escalation:",
          notifyErr.message
        );
      }
    }

    // ── 12-week program: trigger program generation ─────────────────
    try {
      const clients = await query("clients", {
        select: "program",
        filters: { id: `eq.${client_id}` },
        limit: 1,
      });

      const client = clients[0];
      if (client && client.program === "12wk") {
        console.log(
          `[checkin-submit] 12-week client — triggering program generation for week ${weekNum + 1}`
        );
        // Fire-and-forget internal call
        fetch(`${BASE_URL}/api/generate-program`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({
            client_id,
            week_no: weekNum + 1,
          }),
        }).catch((err) => {
          console.error(
            "[checkin-submit] Failed to trigger program generation:",
            err.message
          );
        });
      }
    } catch (lookupErr) {
      console.error(
        "[checkin-submit] Client lookup for program trigger failed:",
        lookupErr.message
      );
    }

    // ── Success response ────────────────────────────────────────────
    const headers_ = {
      "Content-Type": "application/json",
      ...corsHeaders(),
    };
    res.writeHead(200, headers_);
    return res.end(
      JSON.stringify({
        ok: true,
        message:
          "Thank you for submitting your check-in! Your coach will review it and your updated program will be with you shortly. Keep pushing! 💪",
      })
    );
  } catch (err) {
    console.error("[checkin-submit] Unhandled error:", err.message);
    return res
      .status(500)
      .json({ error: "Something went wrong. Please try again or contact support." });
  }
};

// ── Helpers ───────────────────────────────────────────────────────────

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Parse incoming body as JSON or basic multipart.
 * Vercel provides `req.body` for JSON.  For multipart we read the raw
 * stream and extract fields/files manually (no external deps).
 */
async function parseBody(req) {
  const contentType = req.headers["content-type"] || "";

  // JSON body (Vercel auto-parses, but handle raw too)
  if (contentType.includes("application/json")) {
    const body = req.body || (await readRawBody(req));
    const data = typeof body === "string" ? JSON.parse(body) : body;
    // Convert base64 photos
    const photos = (data.photos || []).map((p) => ({
      buffer: Buffer.from(p.data || p, "base64"),
      contentType: p.contentType || "image/jpeg",
    }));
    return { ...data, photos };
  }

  // Multipart form-data
  if (contentType.includes("multipart/form-data")) {
    return parseMultipart(req, contentType);
  }

  // URL-encoded fallback
  const body = req.body || (await readRawBody(req));
  const data = typeof body === "string" ? Object.fromEntries(new URLSearchParams(body)) : body;
  return { ...data, photos: [] };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseMultipart(req, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|(\S+))/);
  if (!boundaryMatch) throw new Error("Missing multipart boundary");
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  const raw = await readRawBody(req);
  const parts = splitMultipartBuffer(raw, boundary);

  const fields = {};
  const photos = [];

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = part.slice(0, headerEnd).toString("utf-8");
    const body = part.slice(headerEnd + 4);

    const nameMatch = headerText.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const filenameMatch = headerText.match(/filename="([^"]+)"/);
    if (filenameMatch) {
      // File field
      const ctMatch = headerText.match(/Content-Type:\s*(\S+)/i);
      photos.push({
        buffer: body,
        contentType: ctMatch ? ctMatch[1] : "image/jpeg",
        filename: filenameMatch[1],
      });
    } else {
      // Text field -- trim trailing \r\n
      fields[name] = body.toString("utf-8").replace(/\r\n$/, "");
    }
  }

  return { ...fields, photos };
}

function splitMultipartBuffer(buf, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;

  while (true) {
    const idx = buf.indexOf(sep, start);
    if (idx === -1) break;

    if (start > 0) {
      // Slice between previous boundary and this one, trimming \r\n
      let partStart = start;
      let partEnd = idx;
      if (buf[partStart] === 0x0d && buf[partStart + 1] === 0x0a) partStart += 2;
      if (buf[partEnd - 2] === 0x0d && buf[partEnd - 1] === 0x0a) partEnd -= 2;
      if (partEnd > partStart) {
        parts.push(buf.slice(partStart, partEnd));
      }
    }

    start = idx + sep.length;
    // Check for closing --
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
  }

  return parts;
}
