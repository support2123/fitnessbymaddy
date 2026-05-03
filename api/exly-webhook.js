const crypto = require('crypto');
const { supabase } = require('./lib/supabase');
const { sendTemplate } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['x-exly-signature'];
  if (process.env.EXLY_WEBHOOK_SECRET && signature) {
    const expected = crypto
      .createHmac('sha256', process.env.EXLY_WEBHOOK_SECRET)
      .update(JSON.stringify(req.body))
      .digest('hex');
    if (signature !== expected) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    const {
      phone, name, email, amount, checkout_id, product_name
    } = req.body;

    if (!phone || !checkout_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const programMap = {
      '6wk_gym': '6wk_gym',
      '6wk_home': '6wk_home',
      '12wk': '12wk',
      'pcos': 'pcos',
      '40plus': '40plus',
      'zoom_trial': 'zoom_trial',
      'zoom_pack': 'zoom_pack'
    };

    let program = null;
    const productLower = (product_name || checkout_id || '').toLowerCase();
    for (const [key, value] of Object.entries(programMap)) {
      if (productLower.includes(key)) {
        program = value;
        break;
      }
    }
    if (!program) program = '6wk_gym';

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .single();

    let leadId = null;
    if (lead) {
      leadId = lead.id;
      await supabase.from('leads').update({
        status: 'converted',
        program_interest: program
      }).eq('id', lead.id);
    } else {
      const { data: newLead } = await supabase.from('leads').insert({
        phone,
        name,
        source: 'exly_direct',
        status: 'converted',
        program_interest: program,
        market: 'IN'
      }).select().single();
      leadId = newLead?.id;
    }

    const programWeeks = { '6wk_gym': 6, '6wk_home': 6, '12wk': 12, 'pcos': 8, '40plus': 8, 'zoom_trial': 1, 'zoom_pack': 4 };
    const weeks = programWeeks[program] || 6;
    const endsAt = new Date();
    endsAt.setDate(endsAt.getDate() + weeks * 7);

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: leadId,
      phone,
      name: name || (lead && lead.name) || null,
      email,
      program,
      paid_amount: parseInt(amount) || 0,
      checkout_id,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt.toISOString(),
      folder_url: null,
      status: 'active'
    }).select().single();

    if (error) throw error;

    const folderPath = `clients/${client.id}`;
    await supabase.storage.from('clients').upload(
      `${folderPath}/.keep`, new Uint8Array(0), { contentType: 'text/plain' }
    );
    await supabase.from('clients').update({ folder_url: folderPath }).eq('id', client.id);

    await sendTemplate(phone, `onboard_${program}`, [name || 'Champion']);

    if (program === '12wk') {
      try {
        const baseUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'https://fitnessbymaddy.com';
        await fetch(`${baseUrl}/api/generate-program`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.INTERNAL_API_KEY
          },
          body: JSON.stringify({ client_id: client.id, week_no: 1 })
        });
      } catch (e) {
        console.error('Program gen trigger failed:', e.message);
      }
    }

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Processing failed' });
  }
};
