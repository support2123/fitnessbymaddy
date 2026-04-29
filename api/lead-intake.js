const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, medical_conditions,
      experience_level, equipment_access
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const updates = {};
    if (name) updates.name = name;

    await db.from('leads').update({
      ...updates,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id, name, email, phone: phone || lead.phone,
      age, gender, height, weight, goal, injuries,
      diet_pref, schedule, medical_conditions,
      experience_level, equipment_access,
      submitted_at: new Date().toISOString()
    };

    const needsEscalation = checkIntakeEscalation(intakeData);

    if (needsEscalation) {
      const { sendWhatsApp } = require('../lib/whatsapp');
      const { maskPhone } = require('../lib/market');
      await sendWhatsApp('917082478374', 'escalation_alert', [
        'Intake form flagged: medical/injury concern',
        maskPhone(lead.phone)
      ]);
    }

    return res.status(200).json({
      success: true,
      message: 'Intake form submitted successfully',
      escalated: needsEscalation
    });

  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

function checkIntakeEscalation(data) {
  const flags = ['injury', 'surgery', 'pregnant', 'diabetes', 'heart',
    'thyroid', 'medication', 'blood pressure', 'asthma'];
  const text = [data.injuries, data.medical_conditions, data.goal]
    .filter(Boolean).join(' ').toLowerCase();
  return flags.some(f => text.includes(f));
}
