const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, phone
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'Missing lead_id or phone' });
    }

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_pref, schedule, experience, medical_conditions
    };

    if (lead_id) {
      const { data: lead } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();

      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      await supabase.from('leads').update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      }).eq('id', lead_id);

      const { data: existingClient } = await supabase
        .from('clients')
        .select('id')
        .eq('lead_id', lead_id)
        .single();

      if (existingClient) {
        await supabase.from('clients').update({
          name: name || undefined,
          email: email || undefined,
          intake_data: intakeData
        }).eq('id', existingClient.id);
      }
    }

    return res.json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
