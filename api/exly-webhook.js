const { supabase } = require('./lib/supabase');
const { sendWhatsApp, detectMarket } = require('./lib/whatsapp');
const crypto = require('crypto');

const PROGRAM_DURATIONS = {
  '6wk_gym': 42, '6wk_home': 42, '12wk': 84,
  'pcos': 42, '40plus': 42, 'zoom_trial': 7, 'zoom_pack': 30
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
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

    const { phone, name, email, amount, checkout_id, product_name } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'phone required' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone)
      .limit(1);

    const leadId = lead && lead.length > 0 ? lead[0].id : null;
    const program = lead && lead.length > 0 ? lead[0].program_interest : '6wk_gym';

    if (leadId) {
      await supabase
        .from('leads')
        .update({ status: 'converted' })
        .eq('id', leadId);
    }

    const durationDays = PROGRAM_DURATIONS[program] || 42;
    const startDate = new Date();
    const endDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const { data: newClient, error } = await supabase
      .from('clients')
      .insert({
        lead_id: leadId,
        phone,
        name: name || (lead && lead[0] ? lead[0].name : null),
        email: email || null,
        program,
        program_started_at: startDate.toISOString(),
        program_ends_at: endDate.toISOString(),
        paid_amount: amount ? parseInt(amount) : null,
        checkout_id: checkout_id || null,
        folder_url: null,
        status: 'active'
      })
      .select()
      .single();

    if (error) throw error;

    const folderPath = `clients/${newClient.id}`;
    await supabase.storage.from('programs').upload(`${folderPath}/.keep`, new Blob(['']));

    await supabase
      .from('clients')
      .update({ folder_url: folderPath })
      .eq('id', newClient.id);

    const market = detectMarket(phone);
    const welcomeMsg = market === 'IN'
      ? `Welcome to the family! 🎉 Tumhara ${program} program start ho gaya hai. Week 1 ka plan jaldi aayega. Let's go! 💪`
      : `Welcome to the family! 🎉 Your ${program} program has started. Week 1 plan coming soon. Let's go! 💪`;

    await sendWhatsApp({
      phone,
      templateName: `onboard_${program}`,
      body: welcomeMsg,
      params: [name || 'Champion']
    });

    return res.status(200).json({ success: true, client_id: newClient.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
