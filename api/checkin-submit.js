// Weekly check-in form submit handler.
// Saves into checkins, escalates on red flags, and triggers program generation
// for 12-week clients.

import { db } from '../lib/supabase.js';
import { json, readBody } from '../lib/http.js';
import { detectEscalation, raiseEscalation } from '../lib/escalation.js';
import { maskPhone } from '../lib/pii.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const body = await readBody(req);
  const clientId = body.c || body.client_id;
  const weekNo = parseInt(body.w || body.week_no, 10);

  if (!clientId || !Number.isFinite(weekNo)) {
    return json(res, 400, { error: 'missing_identity' });
  }

  const sb = db();
  const { data: client } = await sb.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!client) return json(res, 404, { error: 'client_not_found' });

  const row = {
    client_id: client.id,
    week_no: weekNo,
    form_submitted_at: new Date().toISOString(),
    weight: toNum(body.weight),
    waist: toNum(body.waist),
    compliance_score: clampInt(body.compliance, 1, 10),
    energy: clampInt(body.energy, 1, 10),
    issues: clean(body.issues),
    photos_urls: parsePhotos(body.photos),
    next_week_focus: clean(body.focus)
  };

  // Upsert on (client_id, week_no).
  const { error } = await sb.from('checkins').upsert(row, { onConflict: 'client_id,week_no' });
  if (error) {
    console.error('[checkin] upsert failed', error.message);
    return json(res, 500, { error: 'db_error' });
  }

  // Escalation on issues text.
  const kw = detectEscalation(row.issues || '');
  if (kw) {
    await raiseEscalation({
      phone: client.phone,
      client_id: client.id,
      reason: `checkin:${kw}`,
      context: (row.issues || '').slice(0, 400)
    });
  }

  // Trigger program generation for 12-week clients.
  let triggered = false;
  if (client.program === '12wk') {
    triggered = true;
    // Fire-and-forget: generate-program has its own error handling + DB audit.
    const url = `${process.env.SITE_URL || 'https://fitnessbymaddy.com'}/api/generate-program`;
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${process.env.ADMIN_TOKEN || ''}`
      },
      body: JSON.stringify({ client_id: client.id, week_no: weekNo + 1 })
    }).catch((e) => console.error('[checkin] generate kickoff failed', e?.message));
  }

  console.log(`[checkin] ${maskPhone(client.phone)} week ${weekNo} saved triggered=${triggered}`);
  return json(res, 200, { ok: true, triggered_program: triggered });
}

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s.slice(0, 2000) : null;
}
function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}
function parsePhotos(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.slice(0, 10).map(String);
  return String(v).split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
}
