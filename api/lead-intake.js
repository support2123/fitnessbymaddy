const supabase = require('../lib/supabase');
const { detectMarket, corsHeaders } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      name, phone, email, age, goal, injuries,
      diet_pref, schedule, program, photos
    } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ error: 'Name and phone are required' });
    }

    const cleanPhone = phone.replace(/\D/g, '');
    const market = detectMarket(cleanPhone);

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', cleanPhone)
      .single();

    if (existingLead) {
      await supabase.from('leads').update({
        name,
        program_interest: program || null,
        status: 'qualified',
        last_msg_at: new Date().toISOString(),
        market
      }).eq('id', existingLead.id);
    } else {
      await supabase.from('leads').insert({
        phone: cleanPhone,
        name,
        source: 'intake_form',
        status: 'qualified',
        program_interest: program || null,
        market
      });
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('phone', cleanPhone)
      .single();

    if (existingClient) {
      await supabase.from('clients').update({
        name, email, age: age ? parseInt(age) : null,
        goal, injuries, diet_pref, schedule
      }).eq('id', existingClient.id);
    }

    return res.status(200).json({ ok: true, message: 'Intake saved successfully' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
