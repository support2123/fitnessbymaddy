const { supabase } = require('./lib/supabase');
const { sendTemplate, detectMarket } = require('./lib/whatsapp');
const { PROGRAM_NAMES } = require('./lib/escalation');
const crypto = require('crypto');

function verifyExlySignature(body, signature) {
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

function programDurationWeeks(program) {
  switch (program) {
    case '12wk': return 12;
    case '6wk_gym': case '6wk_home': return 6;
    case 'pcos': case '40plus': return 8;
    case 'zoom_trial': return 1;
    case 'zoom_pack': return 4;
    default: return 6;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const signature = req.headers['x-exly-signature'];
  if (!verifyExlySignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  try {
    const { email, phone, name, product_name, amount, checkout_id } = req.body;

    if (!phone) return res.status(400).json({ error: 'phone required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    const program = lead?.program_interest || '6wk_gym';
    const weeks = programDurationWeeks(program);
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    await supabase.from('leads').update({ status: 'converted' }).eq('phone', phone);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name,
      email,
      program,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      paid_amount: amount ? Math.round(amount * 100) : null,
      checkout_id,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}/.keep`;
    await supabase.storage.from('clients').upload(folderPath, '', {
      contentType: 'text/plain',
      upsert: true
    });

    await supabase.from('clients').update({
      folder_url: `clients/${client.id}/`
    }).eq('id', client.id);

    const market = lead?.market || detectMarket(phone);
    const templateName = market === 'IN' ? `onboard_${program}_hi` : `onboard_${program}_en`;
    await sendTemplate(phone, templateName, {
      name: name || lead?.name || 'there',
      templateParams: [
        name || lead?.name || 'there',
        PROGRAM_NAMES[program] || program
      ]
    });

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (genErr) {
        console.error('Week 1 gen failed:', genErr.message);
      }
    }

    return res.json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
