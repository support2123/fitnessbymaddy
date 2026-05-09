const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42,
  '12wk': 84,
  'pcos': 42, '40plus': 42,
  'zoom_trial': 7, 'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const signature = req.headers['x-exly-signature'] || '';
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (signature !== expected) {
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    const { phone, name, email, checkout_id, amount, product_name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let program = null;
    const pn = (product_name || '').toLowerCase();
    if (pn.includes('12') || pn.includes('flagship') || pn.includes('custom')) program = '12wk';
    else if (pn.includes('pcos')) program = 'pcos';
    else if (pn.includes('40')) program = '40plus';
    else if (pn.includes('home')) program = '6wk_home';
    else if (pn.includes('trial')) program = 'zoom_trial';
    else if (pn.includes('zoom') && pn.includes('pack')) program = 'zoom_pack';
    else if (pn.includes('6') || pn.includes('shred') || pn.includes('burn')) program = '6wk_gym';

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .single();

    if (lead) {
      await supabase.from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', lead.id);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startsAt = new Date();
    const endsAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .upsert({
        lead_id: lead ? lead.id : null,
        phone, name, email, program,
        program_started_at: startsAt.toISOString(),
        program_ends_at: endsAt.toISOString(),
        paid_amount: amount,
        checkout_id,
        status: 'active',
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (clientErr) {
      console.error('[exly-webhook] Client upsert error:', clientErr);
      return res.status(500).json({ error: 'Failed to create client' });
    }

    const folderPath = `clients/${client.id}/`;
    await supabase.storage.from('programs').upload(
      `${folderPath}.keep`, '',
      { contentType: 'text/plain', upsert: true }
    );
    await supabase.from('clients')
      .update({ folder_url: folderPath })
      .eq('id', client.id);

    const templateName = `onboard_${program || 'general'}`;
    await sendTemplate(phone, templateName, [name || 'there']);

    if (program === '12wk') {
      try {
        const origin = `https://${req.headers.host}`;
        await fetch(`${origin}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('[exly-webhook] Program gen trigger error:', genErr);
      }
    }

    return res.status(200).json({ ok: true, client_id: client.id });
  } catch (err) {
    console.error('[exly-webhook]', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
