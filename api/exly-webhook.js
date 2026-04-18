const { getSupabase } = require('../lib/supabase');
const { sendTemplate, maskPhone } = require('../lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_MAP = {
  '6wk-burn-build': { program: '6wk_gym', weeks: 6 },
  'pcos-warrior': { program: 'pcos', weeks: 6 },
  '40plus-strong': { program: '40plus', weeks: 6 },
  '12wk-flagship': { program: '12wk', weeks: 12 },
  'zoom-trial': { program: 'zoom_trial', weeks: 1 },
  'zoom-pack': { program: 'zoom_pack', weeks: 4 },
  '6wk-home': { program: '6wk_home', weeks: 6 },
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getSupabase();

  try {
    if (process.env.EXLY_WEBHOOK_SECRET) {
      const sig = req.headers['x-exly-signature'] || '';
      const expected = crypto
        .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
      if (sig !== expected) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const {
      phone, email, name, checkout_id, amount,
      product_id, product_name,
    } = req.body;

    if (!phone) {
      return res.status(400).json({ error: 'Phone required' });
    }

    const programInfo = PROGRAM_MAP[checkout_id] || PROGRAM_MAP[product_id] || { program: '6wk_gym', weeks: 6 };
    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + programInfo.weeks * 7);

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    if (lead) {
      await db.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const { data: client, error: clientErr } = await db.from('clients').insert({
      lead_id: lead?.id || null,
      phone,
      name: name || lead?.name || '',
      email: email || '',
      program: programInfo.program,
      program_started_at: now.toISOString(),
      program_ends_at: endDate.toISOString(),
      paid_amount: amount ? parseFloat(amount) : 0,
      checkout_id: checkout_id || product_id || '',
      status: 'active',
    }).select().single();

    if (clientErr) throw clientErr;

    const folderPath = `clients/${client.id}/`;
    await db.storage.from('client-files').upload(
      `${folderPath}.keep`,
      Buffer.from(''),
      { contentType: 'text/plain' }
    );

    await db.from('clients').update({
      folder_url: folderPath,
    }).eq('id', client.id);

    const templateName = `onboard_${programInfo.program}`;
    try {
      await sendTemplate(phone, templateName, [name || 'there']);
    } catch {
      await sendTemplate(phone, 'onboard_general', [name || 'there', programInfo.program]);
    }

    await db.from('messages').insert({
      phone,
      direction: 'out',
      body: `Welcome aboard! Your ${product_name || programInfo.program} program starts now.`,
      template_name: templateName,
      sent_at: new Date().toISOString(),
      status: 'sent',
    });

    if (programInfo.program === '12wk') {
      try {
        const baseUrl = req.headers['x-forwarded-proto']
          ? `${req.headers['x-forwarded-proto']}://${req.headers['x-forwarded-host']}`
          : `https://${req.headers.host}`;

        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: client.id, week_no: 1 }),
        });
      } catch (genErr) {
        console.error('Week 1 program gen failed:', genErr.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
