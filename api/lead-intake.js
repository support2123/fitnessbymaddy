const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, medications, experience_level,
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
    }).eq('id', lead_id);

    const intakeData = {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, diet_preference, schedule,
      medical_conditions, medications, experience_level,
      submitted_at: new Date().toISOString(),
    };

    const { error: storageError } = await supabase.storage
      .from('intake-forms')
      .upload(
        `${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    if (storageError) {
      console.error('Storage upload error:', storageError.message);
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });

  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
