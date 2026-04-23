const { getSupabase } = require('./_lib/supabase');
const { sendWhatsApp } = require('./_lib/whatsapp');
const { cors, parseBody, programLabel, weekNumber } = require('./_lib/utils');
const { notifyMaddy } = require('./_lib/escalation');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);

  if (process.env.EXLY_WEBHOOK_SECRET) {
    const sig = req.headers['x-exly-signature'];
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (sig !== expected) {
      return res.status(401).json({ error: 'invalid signature' });
    }
  }

  const {
    phone,
    email,
    name,
    checkout_id,
    product_name,
    amount,
    status,
  } = body;

  if (status === 'failed') {
    await notifyMaddy({
      phone,
      reason: 'Payment failure',
      message: `Payment failed for ${name || phone} — ${product_name}`,
      type: 'Payment failure',
    });
    return res.status(200).json({ action: 'payment_failed_notified' });
  }

  if (status !== 'success' && status !== 'completed') {
    return res.status(200).json({ action: 'ignored', status });
  }

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('phone', phone)
    .single();

  if (lead) {
    await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
  }

  const program = mapProductToProgram(product_name);
  const programEnd = programEndDate(program);

  const { data: client, error: clientErr } = await db
    .from('clients')
    .insert({
      lead_id: lead ? lead.id : null,
      phone,
      name: name || (lead ? lead.name : null),
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: programEnd,
      paid_amount: amount || 0,
      checkout_id,
      status: 'active',
    })
    .select()
    .single();

  if (clientErr) {
    console.error('Client insert failed:', clientErr);
    return res.status(500).json({ error: 'client creation failed' });
  }

  const folderPath = `clients/${client.id}`;
  await db.storage.from('clients').upload(`${folderPath}/.keep`, new Blob(['']));

  await db.from('clients').update({
    folder_url: folderPath,
  }).eq('id', client.id);

  const label = programLabel(program);
  await sendWhatsApp(phone, `onboard_${program}`, [
    name || 'there',
    label,
  ]);

  if (program === '12wk') {
    try {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      });
    } catch (e) {
      console.error('Week-1 program generation failed:', e.message);
    }
  }

  return res.status(200).json({ action: 'converted', client_id: client.id });
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const p = productName.toLowerCase();
  if (p.includes('pcos')) return 'pcos';
  if (p.includes('40+') || p.includes('40 plus') || p.includes('forty')) return '40plus';
  if (p.includes('12') || p.includes('custom') || p.includes('flagship')) return '12wk';
  if (p.includes('zoom') && p.includes('pack')) return 'zoom_pack';
  if (p.includes('zoom') || p.includes('trial')) return 'zoom_trial';
  if (p.includes('home')) return '6wk_home';
  return '6wk_gym';
}

function programEndDate(program) {
  const weeks = {
    '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
    'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 8,
  };
  const w = weeks[program] || 6;
  const end = new Date();
  end.setDate(end.getDate() + w * 7);
  return end.toISOString();
}
