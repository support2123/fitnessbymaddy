const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { isHinglish } = require('../lib/market');
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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = process.env.EXLY_WEBHOOK_SECRET;
    if (secret) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig && sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      customer_name, customer_email, customer_phone,
      product_name, amount, checkout_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      return res.status(200).json({ action: 'ignored', reason: 'not completed' });
    }

    if (!customer_phone) {
      return res.status(400).json({ error: 'No phone in webhook' });
    }

    const db = getSupabase();
    const program = mapProductToProgram(product_name);
    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', customer_phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client } = await db.from('clients').insert({
      lead_id: lead ? lead.id : null,
      phone: customer_phone,
      name: customer_name || (lead ? lead.name : null),
      email: customer_email || null,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : 0,
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active'
    }).select().single();

    const folderPath = `clients/${client.id}`;
    await db.storage.from('clients').upload(`${folderPath}/.keep`, new Uint8Array(0), {
      contentType: 'text/plain',
      upsert: true
    });

    await db.from('clients').update({
      folder_url: folderPath
    }).eq('id', client.id);

    const market = lead ? lead.market : 'GLOBAL';
    const templateName = isHinglish(market) ? `onboard_${program}` : `onboard_${program}_en`;
    await sendTemplate(customer_phone, templateName, [
      customer_name || 'there'
    ]);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Initial program generation failed:', e.message);
      }
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
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40+') || lower.includes('40 plus')) return '40plus';
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('zoom trial') || lower.includes('trial')) return 'zoom_trial';
  if (lower.includes('zoom pack')) return 'zoom_pack';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
