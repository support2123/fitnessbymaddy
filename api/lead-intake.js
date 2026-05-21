const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const db = getSupabase();
    const {
      lead_id, name, age, gender, phone, email,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_days, equipment_access,
      current_weight, target_weight, height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name
    }).eq('id', lead_id);

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      email,
      goal,
      injuries: injuries || 'None',
      medical_conditions: medical_conditions || 'None',
      diet_preference: diet_preference || 'No preference',
      training_experience: training_experience || 'Beginner',
      available_days: parseInt(available_days) || 4,
      equipment_access: equipment_access || 'Full gym',
      current_weight: parseFloat(current_weight) || null,
      target_weight: parseFloat(target_weight) || null,
      height: parseFloat(height) || null
    };

    const { error: storageError } = await db.storage
      .from('client-data')
      .upload(
        `intakes/${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageError) {
      console.error('Storage error:', storageError.message);
    }

    return res.status(200).json({ ok: true, message: 'Intake submitted successfully' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
