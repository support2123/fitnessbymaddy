// Weekly check-in form submission handler (public POST from /checkin.html).
// After saving, trigger program generation for 12wk clients.

import { supa } from '../lib/supabase.js';
import { sendText } from '../lib/aisensy.js';
import { jsonResponse, readBody, escalationReason, maskPhone, normalisePhone } from '../lib/utils.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'POST only' });
  const body = await readBody(req);

  const clientId = body.client_id || body.c;
  const weekNo = parseInt(body.week_no || body.w, 10);
  if (!clientId || !Number.isFinite(weekNo)) {
    return jsonResponse(res, 400, { error: 'client_id_and_week_required' });
  }

  const { data: client } = await supa().from('clients').select('*').eq('id', clientId).single();
  if (!client) return jsonResponse(res, 404, { error: 'client_not_found' });

  const photos = Array.isArray(body.photos_urls) ? body.photos_urls : [];

  const { error } = await supa().from('checkins').upsert({
    client_id: clientId,
    week_no: weekNo,
    weight: toFloat(body.weight),
    waist: toFloat(body.waist),
    compliance_score: toInt(body.compliance),
    energy: toInt(body.energy),
    issues: body.issues || null,
    photos_urls: photos
  }, { onConflict: 'client_id,week_no' });
  if (error) return jsonResponse(res, 500, { error: error.message });

  // Escalate on issue text.
  const risky = escalationReason(body.issues || '');
  if (risky) {
    const maddy = normalisePhone(process.env.MADDY_WA_NUMBER);
    if (maddy) {
      await sendText({
        phone: maddy,
        body: `CHECK-IN FLAG → ${maskPhone(client.phone)} (week ${weekNo})\nReason: ${risky}\nIssues: ${(body.issues||'').slice(0,240)}`
      });
    }
  }

  // Trigger program generation for 12wk clients. Fire-and-forget — the
  // /api/generate-program endpoint will handle errors and audit trail.
  if (client.program === '12wk' && !risky) {
    fireAndForget(`/api/generate-program`, { client_id: clientId, week_no: weekNo + 1 });
  }

  return jsonResponse(res, 200, { ok: true });
}

function toInt(v) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function toFloat(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

function fireAndForget(path, payload) {
  const base = process.env.SITE_URL || '';
  const url = base.startsWith('http') ? `${base}${path}` : `https://fitnessbymaddy.com${path}`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.SUPABASE_SERVICE_KEY || ''
    },
    body: JSON.stringify(payload)
  }).catch((e) => console.error('fireAndForget failed', path, e.message));
}
