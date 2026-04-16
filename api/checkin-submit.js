// POST /api/checkin-submit — weekly check-in form submission.
// Body: { client_id, week_no, weight, waist, compliance, energy, issues, photos[] }
import { db } from './_lib/supabase.js';
import { detectEscalation, escalate } from './_lib/escalation.js';
import { readJson } from './_lib/util.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const body = await readJson(req);

  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no, 10);
  if (!clientId || !weekNo) {
    return res.status(400).json({ ok: false, error: 'client_id + week_no required' });
  }

  const supa = db();
  const { data: client, error } = await supa
    .from('clients').select('*').eq('id', clientId).maybeSingle();
  if (error || !client) return res.status(404).json({ ok: false, error: 'client not found' });

  const photos = Array.isArray(body.photos) ? body.photos.slice(0, 6) : [];

  const { error: upErr } = await supa.from('checkins').upsert({
    client_id: clientId,
    week_no: weekNo,
    form_submitted_at: new Date().toISOString(),
    weight: numOrNull(body.weight),
    waist: numOrNull(body.waist),
    compliance_score: clampInt(body.compliance, 1, 10),
    energy: clampInt(body.energy, 1, 10),
    issues: body.issues?.slice(0, 1000) || null,
    photos_urls: photos,
    next_week_focus: body.next_week_focus || null,
  }, { onConflict: 'client_id,week_no' });
  if (upErr) return res.status(500).json({ ok: false, error: upErr.message });

  // Escalate on health-risk wording.
  const trig = detectEscalation(body.issues || '');
  if (trig) {
    await escalate({
      phone: client.phone, clientId,
      trigger: `checkin:${trig}`,
      context: (body.issues || '').slice(0, 280),
    });
  }

  // For 12-week clients, immediately kick off next-week generation.
  if (client.program === '12wk') {
    // Fire-and-forget; do not block the user.
    fetch(`${process.env.PUBLIC_SITE_URL || ''}/api/generate-program`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-cron-secret': process.env.CRON_SECRET || '',
      },
      body: JSON.stringify({ client_id: clientId, week_no: weekNo + 1 }),
    }).catch(() => { /* best effort */ });
  }

  return res.status(200).json({ ok: true });
}

function numOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function clampInt(v, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}
