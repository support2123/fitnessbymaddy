const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { getProgramDuration } = require('../lib/market');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk-shred': '6wk_gym',
  '6wk-home': '6wk_home',
  '12wk-custom': '12wk',
  'pcos-warrior': 'pcos',
  '40plus-strong': '40plus',
  'zoom-trial': 'zoom_trial',
  'zoom-pack': 'zoom_pack',
};

function verifyWebhookSignature(body, signature) {
  if (!process.env.EXLY_WEBHOOK_SECRET) return true;
  const expected = crypto
    .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature || ''),
    Buffer.from(expected)
  );
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET && !verifyWebhookSignature(req.body, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const {
      phone, name, email, checkout_id,
      product_id, amount,
    } = req.body;

    if (!phone || !product_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const program = PROGRAM_MAP[product_id] || '6wk_gym';
    const durationDays = getProgramDuration(program);
    const programEnds = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', lead.id);
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .insert({
        lead_id: lead?.id || null,
        phone,
        name: name || lead?.name || null,
        email: email || null,
        program,
        program_started_at: new Date().toISOString(),
        program_ends_at: programEnds,
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id,
        folder_url: `clients/${lead?.id || 'unknown'}/`,
        status: 'active',
      })
      .select()
      .single();

    if (clientError) {
      console.error('Client creation error:', clientError.message);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('clients').upload(folderPath, '', {
      contentType: 'text/plain',
      upsert: true,
    });

    await supabase
      .from('clients')
      .update({ folder_url: `clients/${client.id}/` })
      .eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'there']);

    if (program === '12wk') {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program generation failed:', genErr.message);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
