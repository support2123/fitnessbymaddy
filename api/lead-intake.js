const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Access-Control-Allow-Origin', '*');

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_days, equipment_access,
      wake_time, sleep_time, notes,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const medicalText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    const escalation = needsEscalation(medicalText);

    let leadRecord;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      leadRecord = data;
    } else if (phone) {
      const { data } = await db.from('leads').select('*').eq('phone', phone).single();
      leadRecord = data;
    }

    if (leadRecord) {
      await db.from('leads').update({
        name: name || leadRecord.name,
        last_msg_at: new Date().toISOString(),
      }).eq('id', leadRecord.id);
    }

    const intakeData = {
      name, email, age: parseInt(age) || null, gender, height, weight: parseFloat(weight) || null,
      goal, injuries, medical_conditions, diet_preference,
      training_experience, available_days, equipment_access,
      wake_time, sleep_time, notes,
      lead_id: leadRecord?.id || lead_id,
      submitted_at: new Date().toISOString(),
    };

    if (escalation) {
      await escalateToMaddy({
        phone: leadRecord?.phone || phone,
        reason: `Intake form flag: "${escalation}" in medical/injury fields`,
        messageBody: medicalText.slice(0, 300),
        clientId: null,
      });
    }

    return res.status(200).json({ success: true, intake: intakeData });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
