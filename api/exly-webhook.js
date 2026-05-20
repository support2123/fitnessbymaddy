const { getSupabase } = require('../lib/supabase');
const { sendWhatsApp } = require('../lib/whatsapp');
const { getProgramInfo, cors } = require('../lib/utils');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
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
      product_name, lead_id,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let leadQuery = db.from('leads').select('*');
    if (lead_id) {
      leadQuery = leadQuery.eq('id', lead_id);
    } else {
      leadQuery = leadQuery.eq('phone', phone);
    }
    const { data: lead } = await leadQuery.single();

    const programKey = matchProgram(product_name, lead?.program_interest);
    const info = getProgramInfo(programKey);
    const weeks = info ? info.weeks : 6;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + weeks * 7);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program: programKey,
      program_started_at: new Date().toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: parseInt(amount) || 0,
      checkout_id,
      folder_url: folderPath,
      status: 'active',
    }).select().single();

    if (error) {
      console.error('Client insert error:', error);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const templateName = `onboard_${programKey}`;
    const market = lead?.market || 'GLOBAL';
    const greeting = market === 'IN'
      ? [`Welcome aboard, ${name || 'champ'}! 🎉 Aapka ${info?.name || 'program'} shuru ho gaya hai.`]
      : [`Welcome aboard, ${name || 'champ'}! 🎉 Your ${info?.name || 'program'} starts now.`];

    await sendWhatsApp(phone, templateName, greeting);

    if (programKey === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (err) {
        console.error('Week-1 program gen failed:', err.message);
      }
    }

    return res.json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function matchProgram(productName, leadInterest) {
  const name = (productName || '').toLowerCase();
  if (name.includes('pcos')) return 'pcos';
  if (name.includes('40+') || name.includes('40 plus')) return '40plus';
  if (name.includes('12') || name.includes('custom') || name.includes('flagship')) return '12wk';
  if (name.includes('trial') || name.includes('zoom')) return 'zoom_trial';
  if (name.includes('home')) return '6wk_home';
  if (name.includes('6') || name.includes('shred') || name.includes('burn')) return '6wk_gym';
  return leadInterest || '6wk_gym';
}
