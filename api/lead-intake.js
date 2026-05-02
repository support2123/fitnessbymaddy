const { supabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      schedule_preference, photos
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    const intakeData = {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      workout_experience, available_days, equipment_access,
      schedule_preference, submitted_at: new Date().toISOString()
    };

    const bucketPath = `intakes/${lead_id}.json`;
    await supabase.storage
      .from('client-data')
      .upload(bucketPath, JSON.stringify(intakeData, null, 2), {
        contentType: 'application/json',
        upsert: true
      });

    if (injuries || medical_conditions) {
      const { escalate } = require('./_lib/escalation');
      await escalate(
        'Medical/injury info on intake form',
        lead.phone,
        `Injuries: ${injuries || 'none'}, Medical: ${medical_conditions || 'none'}`
      );
    }

    return res.status(200).json({ ok: true, message: 'Intake saved' });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
