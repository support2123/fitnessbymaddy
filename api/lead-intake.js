const { supabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        status: lead.status === 'new' ? 'qualified' : lead.status
      })
      .eq('id', lead_id);

    // Store intake data as a note in messages for now
    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      experience, current_weight, target_weight, height, email
    };

    await supabase.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `[INTAKE FORM] ${JSON.stringify(intakeData)}`,
      template_name: 'intake_form'
    });

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
