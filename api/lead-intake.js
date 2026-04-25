const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase.from('leads')
      .select('*').eq('id', lead_id).single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id, name, email, phone: phone || lead.phone,
      age, gender, goal, injuries, diet_preference,
      schedule, medical_conditions, experience_level,
      submitted_at: new Date().toISOString()
    };

    const { error: upsertErr } = await supabase
      .from('lead_intakes')
      .upsert(intakeData, { onConflict: 'lead_id' });

    if (upsertErr) {
      await supabase.from('messages').insert({
        phone: lead.phone, direction: 'out',
        body: `[intake_form] Data saved for ${name}`,
        sent_at: new Date().toISOString(), status: 'logged'
      });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
