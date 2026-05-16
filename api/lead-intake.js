const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, goal, injuries,
      diet_pref, schedule, current_activity, medical_conditions
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    const { data: client, error } = await supabase.from('clients').upsert({
      lead_id,
      phone: lead.phone,
      name: name || lead.name,
      email,
      program: lead.program_interest,
      status: 'active'
    }, { onConflict: 'lead_id' }).select().single();

    if (error && !client) {
      await supabase.from('clients').insert({
        lead_id,
        phone: lead.phone,
        name: name || lead.name,
        email,
        program: lead.program_interest,
        status: 'active'
      });
    }

    return res.status(200).json({ success: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
