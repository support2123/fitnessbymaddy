import supabase from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      height,
      weight,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      medical_conditions,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    const intakeData = {
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: sanitize(injuries),
      diet_preference,
      schedule,
      experience_level,
      medical_conditions: sanitize(medical_conditions),
      email,
      name,
      submitted_at: new Date().toISOString(),
    };

    // Store intake as metadata on the lead (using first_msg as JSON since we have the field)
    await supabase
      .from('leads')
      .update({
        name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function sanitize(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').slice(0, 2000);
}
