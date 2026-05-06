const crypto = require('crypto');
const { getSupabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { handleOptions, maskPhone } = require('../lib/utils');

const PROGRAM_MAP = {
  'shred-6week': { program: '6wk_gym', weeks: 6, amount: 9700 },
  'shred-6week-home': { program: '6wk_home', weeks: 6, amount: 9700 },
  'pcos-warrior': { program: 'pcos', weeks: 6, amount: 4500 },
  '40plus-strong': { program: '40plus', weeks: 6, amount: 5000 },
  '12week-custom': { program: '12wk', weeks: 12, amount: 20000 },
  'zoom-trial': { program: 'zoom_trial', weeks: 1, amount: 2000 },
  'zoom-pack': { program: 'zoom_pack', weeks: 4, amount: 8000 },
};

function verifyWebhook(req) {
  const secret = process.env.EXLY_WEBHOOK_SECRET;
  if (!secret) return true;
  const sig = req.headers['x-exly-signature'] || '';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  return sig === expected;
}

module.exports = async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyWebhook(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const { phone, email, name, checkout_id, product_id, amount } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'phone and checkout_id required' });
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    const supabase = getSupabase();

    const programInfo = PROGRAM_MAP[product_id] || PROGRAM_MAP[checkout_id];
    if (!programInfo) {
      console.error(`Unknown product: ${product_id || checkout_id}`);
      return res.status(400).json({ error: 'Unknown product' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', normalizedPhone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const folderPath = `clients/${crypto.randomUUID()}`;

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead ? lead.id : null,
        phone: normalizedPhone,
        name: name || (lead ? lead.name : null),
        email,
        program: programInfo.program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount || programInfo.amount,
        checkout_id,
        folder_url: folderPath,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      console.error('Client insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    await supabase.storage
      .from('client-files')
      .upload(`${folderPath}/.keep`, Buffer.from(''), {
        contentType: 'text/plain',
      });

    const templateName = `onboard_${programInfo.program}`;
    await sendTemplate(normalizedPhone, templateName, [
      client.name || 'there',
      `${programInfo.weeks} weeks`,
    ]);

    if (programInfo.program === '12wk') {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://fitnessbymaddy.com';

      fetch(`${baseUrl}/api/generate-program`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-key': process.env.CRON_SECRET,
        },
        body: JSON.stringify({ client_id: client.id, week_no: 1 }),
      }).catch(err => console.error('Week 1 gen trigger:', err.message));
    }

    console.log(`Conversion: ${maskPhone(normalizedPhone)} → ${programInfo.program}`);
    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
