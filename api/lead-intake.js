const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, training_experience,
    available_days, equipment, medical_conditions, photos,
  } = req.body;

  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  try {
    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({ name: name || lead.name }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_preference, training_experience, available_days,
      equipment, medical_conditions, photos,
      submitted_at: new Date().toISOString(),
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      await db.from('clients').update({
        name, email, intake_data: intakeData,
      }).eq('id', existingClient.id);
    } else {
      await db.from('clients').upsert({
        lead_id,
        phone: lead.phone,
        name, email,
        program: lead.program_interest || '12wk',
        intake_data: intakeData,
        status: 'active',
      }, { onConflict: 'lead_id' });
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
