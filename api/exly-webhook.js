const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { programDurationWeeks } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = req.headers['x-exly-secret'] || req.headers['x-webhook-secret'];
    if (process.env.EXLY_WEBHOOK_SECRET && secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      customer_phone,
      customer_name,
      customer_email,
      product_id,
      product_name,
      amount,
      checkout_id,
      status,
    } = req.body;

    if (status !== 'completed' && status !== 'paid') {
      return res.status(200).json({ action: 'ignored', reason: 'not_completed' });
    }

    const phone = customer_phone;
    if (!phone) return res.status(400).json({ error: 'No phone' });

    const programMap = {
      '6wk_gym': '6wk_gym',
      '6wk_home': '6wk_home',
      '12wk': '12wk',
      'pcos': 'pcos',
      '40plus': '40plus',
      'zoom_trial': 'zoom_trial',
      'zoom_pack': 'zoom_pack',
    };

    let program = null;
    const lowerProduct = (product_name || product_id || '').toLowerCase();
    for (const [key, val] of Object.entries(programMap)) {
      if (lowerProduct.includes(key) || lowerProduct.includes(key.replace('_', ' '))) {
        program = val;
        break;
      }
    }

    if (!program) {
      if (/shred|burn|6.*week/i.test(lowerProduct)) program = '6wk_gym';
      else if (/12.*week|custom|flagship/i.test(lowerProduct)) program = '12wk';
      else if (/pcos/i.test(lowerProduct)) program = 'pcos';
      else if (/40|forty/i.test(lowerProduct)) program = '40plus';
      else if (/trial|zoom/i.test(lowerProduct)) program = 'zoom_trial';
      else program = '6wk_gym';
    }

    const durationWeeks = programDurationWeeks(program);
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationWeeks * 7 * 24 * 60 * 60 * 1000);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .limit(1)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: customer_name,
        email: customer_email,
        program,
        program_started_at: startsAt.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: Math.round(parseFloat(amount || 0) * 100),
        checkout_id,
        folder_url: `/clients/${phone}/`,
        status: 'active',
      })
      .select()
      .single();

    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there',
      durationWeeks.toString(),
    ]);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (e) {
        console.error('Week-1 program generation failed:', e.message);
      }
    }

    return res.status(200).json({
      success: true,
      client_id: client.id,
      program,
    });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
