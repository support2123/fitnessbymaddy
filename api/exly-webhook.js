const supabase = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');
const crypto = require('crypto');

const PROGRAM_PRICES = {
  '6wk_gym': 9700, '6wk_home': 9700,
  '12wk': 20000, pcos: 4500,
  '40plus': 5000, zoom_trial: 2000, zoom_pack: 10000,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && signature) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = req.body;
    const phone = normalizePhone(payload.phone || payload.mobile || '');
    const email = payload.email || null;
    const name = payload.name || payload.customer_name || null;
    const checkoutId = payload.checkout_id || payload.order_id || null;
    const amount = payload.amount || 0;

    if (!phone) return res.status(400).json({ error: 'No phone' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .maybeSingle();

    const program = lead?.program_interest || detectProgram(amount);
    const programWeeks = program === '12wk' ? 12 : program?.startsWith('6wk') ? 6 : 4;
    const endsAt = new Date(Date.now() + programWeeks * 7 * 24 * 60 * 60 * 1000).toISOString();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: Math.round(amount * 100),
      checkout_id: checkoutId,
      folder_url: null,
      status: 'active',
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('client-files').upload(
      `${folderPath}/.keep`, new Uint8Array(0), { contentType: 'text/plain', upsert: true }
    );
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      program,
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week 1 program generation failed:', e.message);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function normalizePhone(phone) {
  let p = phone.replace(/[\s\-\(\)]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p || null;
}

function detectProgram(amount) {
  if (amount >= 190) return '12wk';
  if (amount >= 90) return '6wk_gym';
  if (amount >= 45) return '40plus';
  if (amount >= 40) return 'pcos';
  return 'zoom_trial';
}
