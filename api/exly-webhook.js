const crypto = require('crypto');
const { getSupabase } = require('./lib/supabase');
const { sendTemplate, detectMarket, isHinglish } = require('./lib/whatsapp');
const { getProgramDuration } = require('./lib/qualify');

function verifyExlySignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const {
      phone, name, email, amount, checkout_id, product_name
    } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'Missing phone or checkout_id' });
    }

    const db = getSupabase();

    const programMap = {
      '6-week burn': '6wk_gym',
      '6-week home': '6wk_home',
      '12-week': '12wk',
      'pcos': 'pcos',
      '40+': '40plus',
      'zoom trial': 'zoom_trial',
      'zoom pack': 'zoom_pack'
    };

    let program = null;
    if (product_name) {
      const lower = product_name.toLowerCase();
      for (const [key, val] of Object.entries(programMap)) {
        if (lower.includes(key)) { program = val; break; }
      }
    }

    const { data: lead } = await db
      .from('leads')
      .select('id, market, program_interest')
      .eq('phone', phone)
      .single();

    const leadId = lead?.id || null;
    const market = lead?.market || detectMarket(phone);
    program = program || lead?.program_interest || '6wk_gym';
    const weeks = getProgramDuration(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    if (leadId) {
      await db.from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const { data: client, error } = await db.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || lead?.name || null,
      email,
      program,
      paid_amount: amount ? parseInt(amount) : null,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      folder_url: `/clients/${leadId || 'direct'}/`,
      status: 'active'
    }).select('id').single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${program}`, [
      name || 'there',
      `${weeks} weeks`
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Week-1 program gen failed:', e.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('exly-webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
