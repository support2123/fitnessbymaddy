const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id,
      name,
      email,
      age,
      gender,
      goal,
      injuries,
      medical_conditions,
      diet_preference,
      workout_days,
      equipment_access,
      schedule_preference,
      current_weight,
      target_weight,
      height
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(', ');
    if (needsEscalation(medicalText)) {
      await createEscalation(lead.phone, 'Medical condition reported in intake form', medicalText);
    }

    // Store intake data as a JSON file in Supabase Storage
    const intakeData = {
      lead_id, name, email, age, gender, goal, injuries,
      medical_conditions, diet_preference, workout_days,
      equipment_access, schedule_preference, current_weight,
      target_weight, height, submitted_at: new Date().toISOString()
    };

    await db.storage
      .from('clients')
      .upload(
        `intake/${lead_id}.json`,
        JSON.stringify(intakeData, null, 2),
        { contentType: 'application/json', upsert: true }
      );

    return res.status(200).json({ ok: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
