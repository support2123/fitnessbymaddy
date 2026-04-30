const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      schedule, workout_experience, equipment_access,
      photos
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status
    }).eq('id', lead_id);

    await db.from('intake_data').upsert({
      lead_id,
      name,
      email,
      age: parseInt(age) || null,
      gender,
      height,
      weight: parseFloat(weight) || null,
      goal,
      injuries: injuries || null,
      medical_conditions: medical_conditions || null,
      diet_preference,
      schedule,
      workout_experience,
      equipment_access,
      photos: photos || [],
      submitted_at: new Date().toISOString()
    }, { onConflict: 'lead_id' });

    const medicalCheck = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    const esc = needsEscalation(medicalCheck);
    if (esc.escalate) {
      await escalateToMaddy({
        reason: `Intake form — keyword: "${esc.trigger}"`,
        phone: lead.phone,
        clientName: name,
        messageText: medicalCheck
      });
    }

    return res.status(200).json({ success: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
