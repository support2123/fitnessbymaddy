const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket, isHinglish } = require('./_lib/market');
const { PROGRAM_LABELS } = require('./_lib/escalation');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30
};

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

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

    const {
      phone, email, name, amount, checkout_id,
      product_name, lead_id
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    let leadRecord;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      leadRecord = data;
    }
    if (!leadRecord) {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      leadRecord = data;
    }

    const program = leadRecord?.program_interest || mapProductToProgram(product_name);
    const now = new Date();
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client } = await db.from('clients').insert({
      lead_id: leadRecord?.id || null,
      phone,
      name: name || leadRecord?.name,
      email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id,
      folder_url: null,
      status: 'active'
    }).select().single();

    if (leadRecord) {
      await db.from('leads').update({ status: 'converted' }).eq('id', leadRecord.id);
    }

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('clients').upload(`${client.id}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });
    await db.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    const market = leadRecord?.market || detectMarket(phone);
    const templateName = isHinglish(market) ? `onboard_${program}` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, [
      client.name || 'there',
      PROGRAM_LABELS[program] || program
    ], client.name);

    if (program === '12wk') {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function mapProductToProgram(productName) {
  if (!productName) return '6wk_gym';
  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
