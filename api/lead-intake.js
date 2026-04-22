import supabase from './lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lead_id,
      age,
      gender,
      height_cm,
      weight_kg,
      goal,
      injuries,
      diet_preference,
      training_experience,
      schedule,
      medical_conditions,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id, name')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const { data, error } = await supabase.from('intake_forms').insert({
      lead_id,
      age: age ? parseInt(age, 10) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries,
      diet_preference,
      training_experience,
      schedule,
      medical_conditions,
    }).select().single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ status: 'ok', id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
