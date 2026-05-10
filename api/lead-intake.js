const supabase = require('./_lib/supabase');
const { handleCors } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, current_fitness, experience_level
    } = req.body;

    if (!lead_id || !name || !phone) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, phone' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({
      name,
      program_interest: lead.program_interest || goal
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email: email || null,
      phone,
      age: age ? parseInt(age) : null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      current_fitness: current_fitness || null,
      experience_level: experience_level || null,
      submitted_at: new Date().toISOString()
    };

    const { error: storageErr } = await supabase.storage
      .from('clients')
      .upload(
        `intake/${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageErr) console.error('Intake storage error:', storageErr.message);

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
