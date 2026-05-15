const crypto = require('crypto');
const { supabase } = require('../lib/supabase');
const { sendTemplate, notifyMaddy } = require('../lib/whatsapp');
const { normalizePhone, programDurationWeeks, addWeeks, maskPhone } = require('../lib/utils');

function verifyExlySignature(payload, signature) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature || ''), Buffer.from(expected));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'];
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyExlySignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      checkout_id, customer_name, customer_email, customer_phone,
      amount, product_name, product_id, status
    } = req.body;

    if (status !== 'completed' && status !== 'success') {
      if (status === 'failed') {
        const phone = normalizePhone(customer_phone);
        await notifyMaddy(
          'Payment Failed',
          `${customer_name} (${maskPhone(phone)}) — payment failed for ${product_name}`
        );
      }
      return res.status(200).json({ action: 'ignored', status });
    }

    const phone = normalizePhone(customer_phone);

    const programMap = {
      '6wk-burn-build': '6wk_gym',
      '6wk-home': '6wk_home',
      '12wk-flagship': '12wk',
      'pcos-warrior': 'pcos',
      '40plus-strong': '40plus',
      'zoom-trial': 'zoom_trial',
      'zoom-pack': 'zoom_pack'
    };

    const program = programMap[product_id] || programMap[checkout_id] || '6wk_gym';
    const weeks = programDurationWeeks(program);
    const now = new Date();
    const endsAt = addWeeks(now, weeks);

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const folderPath = `clients/${phone.replace('+', '')}`;

    const { data: client, error: clientError } = await supabase.from('clients').insert({
      lead_id: lead?.id,
      phone,
      name: customer_name,
      email: customer_email,
      program,
      program_started_at: now.toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount,
      checkout_id: checkout_id || product_id,
      folder_url: folderPath,
      status: 'active'
    }).select('id').single();

    if (clientError) {
      console.error('Client insert error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await sendTemplate(phone, `onboard_${program}`, [
      customer_name || 'there',
      `${weeks} weeks`,
      'fitnessbymaddy.com'
    ]);

    if (program === '12wk') {
      const origin = `https://${req.headers.host}`;
      await fetch(`${origin}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 })
      });
    }

    return res.status(200).json({ action: 'converted', client_id: client.id, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
