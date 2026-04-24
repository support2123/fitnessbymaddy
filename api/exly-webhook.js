const { supabase } = require('../lib/supabase');
const { sendTemplate } = require('../lib/whatsapp');
const { maskPhone, programWeeks, PROGRAM_NAMES } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const secret = req.headers['x-webhook-secret'] || req.query.secret;
    if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const {
      phone, email, name, amount, checkout_id,
      product_name, lead_id,
    } = req.body;

    if (!phone) return res.status(400).json({ error: 'Missing phone' });

    let program = null;
    const pn = (product_name || '').toLowerCase();
    if (pn.includes('12') || pn.includes('flagship') || pn.includes('custom')) program = '12wk';
    else if (pn.includes('pcos')) program = 'pcos';
    else if (pn.includes('40')) program = '40plus';
    else if (pn.includes('trial') || pn.includes('zoom')) program = 'zoom_trial';
    else if (pn.includes('home')) program = '6wk_home';
    else program = '6wk_gym';

    const weeks = programWeeks(program);
    const now = new Date();
    const endsAt = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

    let leadIdResolved = lead_id;
    if (!leadIdResolved) {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .single();
      leadIdResolved = lead?.id;
    }

    if (leadIdResolved) {
      await supabase.from('leads')
        .update({ status: 'converted', program_interest: program })
        .eq('id', leadIdResolved);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', phone)
      .single();

    let clientId;
    if (existingClient) {
      await supabase.from('clients').update({
        program,
        paid_amount: parseInt(amount) || 0,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        status: 'active',
        name: name || undefined,
        email: email || undefined,
      }).eq('id', existingClient.id);
      clientId = existingClient.id;
    } else {
      const { data: client } = await supabase.from('clients').insert({
        lead_id: leadIdResolved,
        phone,
        name,
        email,
        program,
        paid_amount: parseInt(amount) || 0,
        checkout_id,
        program_started_at: now.toISOString(),
        program_ends_at: endsAt.toISOString(),
        status: 'active',
      }).select().single();
      clientId = client?.id;
    }

    if (clientId) {
      const folderPath = `clients/${clientId}`;
      const placeholder = new Uint8Array([0]);
      await supabase.storage
        .from('clients')
        .upload(`${folderPath}/.keep`, placeholder, { upsert: true });

      await supabase.from('clients')
        .update({ folder_url: folderPath })
        .eq('id', clientId);
    }

    const templateName = `onboard_${program}`;
    await sendTemplate(phone, templateName, [name || 'there', PROGRAM_NAMES[program] || program]);

    if (program === '12wk' && clientId) {
      try {
        const baseUrl = `https://${req.headers.host}`;
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
          body: JSON.stringify({ client_id: clientId, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week-1 generation trigger failed:', genErr.message);
      }
    }

    console.log(`Purchase: ${maskPhone(phone)} → ${program} ($${amount})`);
    return res.status(200).json({ ok: true, client_id: clientId, program });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
