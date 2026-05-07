const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      schedule_preference
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString()
      })
      .eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal,
      injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      schedule_preference, email
    };

    const { error: storageError } = await supabase.storage
      .from('clients')
      .upload(
        `intakes/${lead_id}.json`,
        Buffer.from(JSON.stringify(intakeData, null, 2)),
        { contentType: 'application/json', upsert: true }
      );

    if (storageError) {
      console.error('Intake storage error:', storageError.message);
    }

    if (injuries || medical_conditions) {
      const { escalateToMaddy } = require('./_lib/escalation');
      await escalateToMaddy(
        lead.phone,
        'Medical flag in intake form',
        `Injuries: ${injuries || 'none'} | Medical: ${medical_conditions || 'none'}`
      );
    }

    return res.status(200).json({ success: true, lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
