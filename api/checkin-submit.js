// Weekly check-in form handler.
// Validates one-time token, stores stats, then asynchronously triggers program generation (for 12wk clients).
// Body: { token, client, week, weight, waist, compliance, energy, issues, photos: [] }

const { admin } = require('./_lib/supabase');
const { readJson, ok, err, assertMethod, maskPhone } = require('./_lib/utils');
const escalation = require('./_lib/escalation');

module.exports = async (req, res) => {
  if (!assertMethod(req, res, ['POST'])) return;
  const body = await readJson(req);

  if (!body.client || !body.week) return err(res, 400, 'missing_client_or_week');
  const sb = admin();

  const { data: checkin } = await sb.from('checkins')
    .select('id, client_id, week_no, token, form_submitted_at')
    .eq('client_id', body.client).eq('week_no', body.week).maybeSingle();

  if (!checkin) return err(res, 404, 'checkin_not_scheduled');
  if (body.token && checkin.token && body.token !== checkin.token) {
    return err(res, 403, 'bad_token');
  }
  if (checkin.form_submitted_at) {
    // Idempotent: already submitted
    return ok(res, { duplicate: true, id: checkin.id });
  }

  const { data: client } = await sb.from('clients').select('*').eq('id', body.client).maybeSingle();
  if (!client) return err(res, 404, 'client_not_found');

  const redFlag = escalation.detect(body.issues || '');

  const upd = {
    form_submitted_at: new Date().toISOString(),
    weight: parseNum(body.weight),
    waist: parseNum(body.waist),
    compliance_score: parseInt(body.compliance, 10) || null,
    energy: parseInt(body.energy, 10) || null,
    issues: body.issues || null,
    photos_urls: Array.isArray(body.photos) ? body.photos : [],
    next_week_focus: body.next_focus || null,
  };
  await sb.from('checkins').update(upd).eq('id', checkin.id);

  // Reset missed counter
  await sb.from('clients').update({ missed_checkins: 0 }).eq('id', client.id);

  if (redFlag) {
    await escalation.raise({
      phone: client.phone, clientId: client.id,
      trigger: redFlag, detail: body.issues?.slice(0, 500),
    });
    await escalation.notifyMaddy({
      trigger: redFlag, phone: maskPhone(client.phone),
      detail: `Client check-in (week ${body.week}) flagged: ${body.issues?.slice(0, 200)}`,
    });
  }

  // Fire-and-forget program generation for 12wk clients
  if (client.program === '12wk') {
    triggerProgramGeneration(client.id).catch((e) =>
      console.error(`[gen-fail] ${maskPhone(client.phone)} ${e.message || e}`));
  }

  return ok(res, { id: checkin.id, flagged: !!redFlag });
};

function parseNum(v) { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

async function triggerProgramGeneration(clientId) {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  try {
    await fetch(`${base}/api/generate-program`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': process.env.SUPABASE_SERVICE_KEY || '',
      },
      body: JSON.stringify({ client_id: clientId }),
    });
  } catch (e) {
    console.error(`[gen-trigger-fail] ${e.message || e}`);
  }
}
