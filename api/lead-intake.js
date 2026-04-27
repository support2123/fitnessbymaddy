const { getSupabase } = require('./_lib/supabase');
const { maskPhone } = require('./_lib/pii');
const { needsEscalation, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions,
      diet_preference, workout_schedule, equipment_access,
      current_weight, target_weight, height,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, workout_schedule, equipment_access,
      current_weight, target_weight, height,
      submitted_at: new Date().toISOString(),
    };

    await db.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    const fieldsToCheck = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const escalationKeyword = needsEscalation(fieldsToCheck);
    if (escalationKeyword) {
      await createEscalation(lead.phone, null, `Intake form: ${escalationKeyword}`, fieldsToCheck);
    }

    console.log(`Intake submitted for lead ${maskPhone(lead.phone)}`);

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully',
      intake: intakeData,
    });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
