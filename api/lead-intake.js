const { getSupabase } = require('./lib/supabase');
const { needsEscalation, createEscalation } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, equipment,
      medical_conditions, current_weight, target_weight, height
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
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const medicalText = [injuries, medical_conditions].filter(Boolean).join('. ');
    const escalationReason = needsEscalation(medicalText);
    if (escalationReason) {
      await createEscalation(
        lead.phone,
        `Intake form — ${escalationReason}`,
        medicalText
      );
    }

    return res.json({
      ok: true,
      message: 'Intake form submitted successfully'
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Submission failed' });
  }
};
