const { supabase } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      current_weight,
      target_weight,
      experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('id')
      .eq('id', lead_id)
      .maybeSingle();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase
      .from('leads')
      .update({
        name: name || undefined,
      })
      .eq('id', lead_id);

    const { error } = await supabase.from('intake_data').upsert({
      lead_id,
      name,
      email,
      phone,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      experience_level,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'lead_id' });

    if (error) {
      console.error('Intake save error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
