// Exly purchase confirmation webhook.
// Verifies signature, promotes lead -> client, schedules first checkin, sends onboarding message.

const crypto = require('crypto');
const { admin } = require('./_lib/supabase');
const { sendText } = require('./_lib/aisensy');
const { readJson, ok, err, assertMethod, normalisePhone, marketFromPhone, maskPhone, cryptoRandomToken } = require('./_lib/utils');
const { campaign, onboardBody } = require('./_lib/templates');
const { intakeUrl } = require('./_lib/router');

module.exports = async (req, res) => {
  if (!assertMethod(req, res, ['POST'])) return;

  const raw = await readRawBody(req);
  let body;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { return err(res, 400, 'bad_json'); }

  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (secret) {
    const sigHeader = req.headers['x-exly-signature'] || req.headers['x-signature'] || '';
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(sigHeader.toString().replace(/^sha256=/, ''), 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return err(res, 401, 'bad_signature');
    }
  }

  const phone = normalisePhone(body.phone || body.mobile || body.customer_phone);
  if (!phone) return err(res, 400, 'missing_phone');

  const program = mapProgram(body.product_id || body.plan || body.offering_name || '');
  if (!program) return err(res, 400, 'unknown_program');

  const sb = admin();
  const market = marketFromPhone(phone);
  const now = new Date();
  const endsAt = new Date(now.getTime() + durationDays(program) * 86400 * 1000);

  // Find linked lead
  const { data: lead } = await sb.from('leads').select('id').eq('phone', phone).maybeSingle();

  // Upsert client
  const { data: client, error: cErr } = await sb.from('clients').upsert({
    lead_id: lead?.id || null,
    phone,
    name: body.customer_name || body.name || null,
    email: body.email || body.customer_email || null,
    program,
    program_started_at: now.toISOString(),
    program_ends_at: endsAt.toISOString(),
    paid_amount: Number(body.amount || body.total || 0) || null,
    checkout_id: body.checkout_id || body.order_id || body.transaction_id || null,
    market,
    status: 'active',
  }, { onConflict: 'phone' }).select().single();

  if (cErr) {
    console.error(`[exly-client-upsert-fail] ${maskPhone(phone)} ${cErr.message}`);
    return err(res, 500, 'client_upsert_failed');
  }

  const folderUrl = `clients/${client.id}/`;
  await sb.from('clients').update({ folder_url: folderUrl }).eq('id', client.id);

  // Mark lead converted
  if (lead) await sb.from('leads').update({ status: 'converted' }).eq('id', lead.id);

  // Schedule first check-in row (week 1) with token
  const token = cryptoRandomToken(16);
  await sb.from('checkins').upsert({
    client_id: client.id, week_no: 1, token,
  }, { onConflict: 'client_id,week_no' });

  // Onboarding WhatsApp
  const ink = intakeUrl(client.id);
  const msgBody = onboardBody(program, market, client.name).replace('{INTAKE_URL}', ink);
  await sendText({
    to: phone, body: msgBody,
    campaignName: campaign(`onboard_${program}`) || campaign('welcome'),
    userName: client.name || 'there',
    templateParams: [client.name || 'there', ink],
    bypassRateLimit: true,
  });

  // If 12-week, kick off Week 1 program generation immediately
  if (program === '12wk') {
    triggerGen(client.id).catch((e) => console.error(`[gen-trigger-fail] ${e.message || e}`));
  }

  return ok(res, { client_id: client.id, program });
};

async function readRawBody(req) {
  return await new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function mapProgram(key) {
  const k = String(key || '').toLowerCase();
  if (/12.?week|flagship/.test(k)) return '12wk';
  if (/pcos/.test(k)) return 'pcos';
  if (/40\+|forty|menopaus/.test(k)) return '40plus';
  if (/home/.test(k)) return '6wk_home';
  if (/6.?week|burn|shred/.test(k)) return '6wk_gym';
  if (/zoom.?trial|trial/.test(k)) return 'zoom_trial';
  if (/zoom.?pack|zoom/.test(k)) return 'zoom_pack';
  // Allow direct mapping
  const allowed = ['6wk_gym','6wk_home','12wk','pcos','40plus','zoom_trial','zoom_pack'];
  if (allowed.includes(k)) return k;
  return null;
}

function durationDays(program) {
  return { '6wk_gym': 42, '6wk_home': 42, '12wk': 84, 'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30 }[program] || 42;
}

async function triggerGen(clientId) {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  await fetch(`${base}/api/generate-program`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': process.env.SUPABASE_SERVICE_KEY || '',
    },
    body: JSON.stringify({ client_id: clientId }),
  });
}
