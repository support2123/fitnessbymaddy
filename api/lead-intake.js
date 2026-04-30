const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      experience_level, current_weight, target_weight,
      medical_conditions, supplements,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone, status')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    // Store intake data as a JSON field or in a separate intake table
    // For now, we store key info on the lead and log the full intake
    const intakeData = {
      name, email, phone, age, gender, goal, injuries,
      diet_preference, schedule, experience_level,
      current_weight, target_weight, medical_conditions, supplements,
      submitted_at: new Date().toISOString(),
    };

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: JSON.stringify(intakeData),
      template_name: 'intake_form_submission',
    });

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
