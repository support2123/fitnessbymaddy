const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');
const { programPrice } = require('./lib/utils');

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone,
      email,
      name,
      checkout_id,
      product_name,
      amount,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Missing phone' });
    }

    const programMap = {
      '6 week shred': '6wk_gym',
      '6 week home': '6wk_home',
      '6wk burn': '6wk_gym',
      '12 week': '12wk',
      '12wk': '12wk',
      'flagship': '12wk',
      'pcos': 'pcos',
      'pcos warrior': 'pcos',
      '40+': '40plus',
      '40 plus': '40plus',
      'zoom trial': 'zoom_trial',
      'trial': 'zoom_trial',
      'zoom pack': 'zoom_pack',
    };

    let program = null;
    if (product_name) {
      const pn = product_name.toLowerCase();
      for (const [key, val] of Object.entries(programMap)) {
        if (pn.includes(key)) {
          program = val;
          break;
        }
      }
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const programWeeks = {
      '6wk_gym': 6, '6wk_home': 6, '12wk': 12,
      'pcos': 6, '40plus': 6, 'zoom_trial': 1, 'zoom_pack': 4,
    };
    const weeks = programWeeks[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id: lead?.id || null,
      phone,
      name: name || null,
      email: email || null,
      program,
      paid_amount: amount || programPrice(program),
      checkout_id: checkout_id || null,
      folder_url: null,
      status: 'active',
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
    }, {
      onConflict: 'phone',
      ignoreDuplicates: false,
    }).select().single();

    if (error) {
      console.error('Client upsert error:', error.message);
      const { data: inserted } = await supabase.from('clients').insert({
        lead_id: lead?.id || null,
        phone,
        name: name || null,
        email: email || null,
        program,
        paid_amount: amount || programPrice(program),
        checkout_id: checkout_id || null,
        status: 'active',
        program_started_at: new Date().toISOString(),
        program_ends_at: endsAt.toISOString(),
      }).select().single();

      if (!inserted) {
        return res.status(500).json({ error: 'Failed to create client' });
      }
    }

    const templateName = `onboard_${program || 'general'}`;
    await sendWhatsApp(phone, [name || 'there'], templateName);

    if (program === '12wk') {
      try {
        const clientId = client?.id;
        if (clientId) {
          const baseUrl = process.env.VERCEL_URL
            ? `https://${process.env.VERCEL_URL}`
            : 'https://fitnessbymaddy.com';
          await fetch(`${baseUrl}/api/generate-program`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: clientId, week_no: 1 }),
          });
        }
      } catch (e) {
        console.error('Week-1 program gen failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client?.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
