const crypto = require('crypto');
const { getSupabase } = require('./_lib/supabase');
const { sendTemplate } = require('./_lib/whatsapp');
const { detectMarket } = require('./_lib/market');

const PROGRAM_MAP = {
  '6wk_gym': { duration: 42, name: '6-Week Burn & Build (Gym)' },
  '6wk_home': { duration: 42, name: '6-Week Burn & Build (Home)' },
  '12wk': { duration: 84, name: '12-Week Flagship' },
  'pcos': { duration: 42, name: 'PCOS Warrior' },
  '40plus': { duration: 42, name: '40+ Strong' },
  'zoom_trial': { duration: 7, name: 'Zoom Trial' },
  'zoom_pack': { duration: 30, name: 'Zoom Pack' }
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || req.headers['x-webhook-signature'] || '';
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
      phone, name, email, amount, checkout_id,
      product_name, product_id, status
    } = req.body;

    if (status && status !== 'completed' && status !== 'success') {
      return res.json({ action: 'ignored', reason: 'payment not completed' });
    }

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    const normalizedPhone = phone.replace(/[^0-9]/g, '');
    const db = getSupabase();
    const market = detectMarket(normalizedPhone);
    const program = detectProgram(product_name, amount);
    const programInfo = PROGRAM_MAP[program] || PROGRAM_MAP['6wk_gym'];

    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + programInfo.duration * 24 * 60 * 60 * 1000);

    const { data: lead } = await db
      .from('leads')
      .select('id')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${normalizedPhone}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone: normalizedPhone,
      name: name || null,
      email: email || null,
      program,
      program_started_at: startDate.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? Math.round(parseFloat(amount) * 100) : 0,
      checkout_id: checkout_id || product_id || null,
      folder_url: folderPath,
      status: 'active'
    }).select('id').single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await db.storage.from('client-files').upload(
      `${folderPath}/.init`,
      Buffer.from(''),
      { contentType: 'text/plain', upsert: true }
    );

    const templateName = `onboard_${program}`;
    await sendTemplate(normalizedPhone, templateName, [
      name || 'there',
      programInfo.name,
      `https://fitnessbymaddy.com/checkin?c=${client.id}&w=1`
    ], market);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function detectProgram(productName, amount) {
  if (!productName) {
    const num = parseFloat(amount) || 0;
    if (num <= 25) return 'zoom_trial';
    if (num <= 50) return 'pcos';
    if (num <= 55) return '40plus';
    if (num <= 100) return '6wk_gym';
    return '12wk';
  }

  const lower = productName.toLowerCase();
  if (lower.includes('12') || lower.includes('flagship') || lower.includes('custom')) return '12wk';
  if (lower.includes('pcos')) return 'pcos';
  if (lower.includes('40') || lower.includes('strong')) return '40plus';
  if (lower.includes('trial') || lower.includes('zoom')) return 'zoom_trial';
  if (lower.includes('home')) return '6wk_home';
  return '6wk_gym';
}
