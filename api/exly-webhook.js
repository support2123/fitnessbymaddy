const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendWhatsApp, normalizePhone } = require('./lib/whatsapp');
const { handleCors, jsonError, jsonOk, PROGRAM_INFO } = require('./lib/helpers');

function verifyExlySignature(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-exly-signature'] || '';
  const body = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function programDuration(program) {
  const durations = {
    '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
    pcos: 42, '40plus': 42, zoom_trial: 7, zoom_pack: 30,
  };
  return durations[program] || 42;
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return jsonError(res, 'POST only', 405);

  if (!verifyExlySignature(req)) {
    return jsonError(res, 'Invalid signature', 403);
  }

  const db = getSupabase();
  const {
    phone: rawPhone, email, name, amount,
    checkout_id, product_name, status,
  } = req.body || {};

  if (status && status !== 'completed' && status !== 'success') {
    return jsonOk(res, { action: 'ignored_non_success' });
  }

  const phone = normalizePhone(rawPhone);
  if (!phone) return jsonError(res, 'No phone');

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .limit(1)
    .single();

  const program = lead?.program_interest || inferProgram(product_name, amount);
  const now = new Date();
  const days = programDuration(program);
  const endDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const { data: existingClient } = await db
    .from('clients')
    .select('id')
    .eq('phone', phone)
    .limit(1)
    .single();

  let clientId;

  if (existingClient) {
    await db.from('clients').update({
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount,
      checkout_id,
      status: 'active',
      email: email || undefined,
      name: name || undefined,
    }).eq('id', existingClient.id);
    clientId = existingClient.id;
  } else {
    const { data: newClient } = await db.from('clients').insert({
      lead_id: lead?.id,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: `/clients/${phone}/`,
      status: 'active',
    }).select('id').single();
    clientId = newClient?.id;
  }

  const folderPath = `clients/${clientId}`;
  await db.storage.from('client-files').upload(
    `${folderPath}/.keep`,
    new Uint8Array([]),
    { upsert: true }
  );

  const programInfo = PROGRAM_INFO[program];
  const templateName = `onboard_${program}`;
  await sendWhatsApp(phone, templateName, [
    name || 'there',
    programInfo?.name || program,
  ], true);

  return jsonOk(res, { action: 'converted', clientId, program });
};

function inferProgram(productName, amount) {
  if (!productName) return '6wk_gym';
  const lower = (productName || '').toLowerCase();
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('home')) return '6wk_home';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (amount && amount <= 2500) return 'zoom_trial';
  return '6wk_gym';
}
