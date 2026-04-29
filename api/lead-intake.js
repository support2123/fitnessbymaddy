const { getClient, updateLead } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      training_experience,
      schedule_preference,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getClient();

    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) await updateLead(lead_id, { name });

    const { error: intakeErr } = await db
      .from('lead_intake')
      .upsert({
        lead_id,
        name: name || lead.name,
        email,
        age: age ? parseInt(age) : null,
        gender,
        goal,
        injuries: injuries || null,
        diet_preference,
        training_experience,
        schedule_preference,
        current_weight: current_weight ? parseFloat(current_weight) : null,
        target_weight: target_weight ? parseFloat(target_weight) : null,
        medical_conditions: medical_conditions || null,
        submitted_at: new Date().toISOString(),
      }, { onConflict: 'lead_id' });

    if (intakeErr) {
      console.error('Intake save error:', intakeErr.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
