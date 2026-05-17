const { supabase } = require('./lib/supabase');
const { sendWhatsApp } = require('./lib/whatsapp');

const PROGRAM_DURATION = {
  '6wk_gym': 42,
  '6wk_home': 42,
  '12wk': 84,
  'pcos': 42,
  '40plus': 42,
  'zoom_trial': 7,
  'zoom_pack': 30,
};

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-exly-secret'] || req.query.secret;
  if (secret !== process.env.EXLY_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { lead_id, phone, name, email, amount, checkout_id, program } = req.body;

    if (!phone && !lead_id) return res.status(400).json({ error: 'Missing phone or lead_id' });

    let lead;
    if (lead_id) {
      const { data } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else {
      const { data } = await supabase.from('leads').select('*').eq('phone', phone).single();
      lead = data;
    }

    if (!lead) {
      const { data: newLead } = await supabase.from('leads').insert({
        phone, name, status: 'converted', program_interest: program,
      }).select().single();
      lead = newLead;
    } else {
      await supabase.from('leads').update({ status: 'converted' }).eq('id', lead.id);
    }

    const programType = program || lead.program_interest || '6wk_gym';
    const durationDays = PROGRAM_DURATION[programType] || 42;
    const endsAt = new Date(Date.now() + durationDays * 86400000).toISOString();

    const { data: client, error } = await supabase.from('clients').insert({
      lead_id: lead.id,
      phone: lead.phone,
      name: name || lead.name,
      email: email || null,
      program: programType,
      program_started_at: new Date().toISOString(),
      program_ends_at: endsAt,
      paid_amount: parseInt(amount) || 0,
      checkout_id: checkout_id || null,
      folder_url: `/clients/${lead.id}/`,
      status: 'active',
    }).select().single();

    if (error) throw error;

    await sendWhatsApp(lead.phone, `onboard_${programType}`, [
      name || lead.name || 'there',
      programType.replace(/_/g, ' '),
    ]);

    return res.status(200).json({ success: true, client_id: client.id });
  } catch (err) {
    console.error('Exly webhook error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
