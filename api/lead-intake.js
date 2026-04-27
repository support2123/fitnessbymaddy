const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');
const { maskPhone } = require('../lib/pii');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag on intake form', {
        lead_id,
        phone: maskPhone(phone),
        injuries,
        medical_conditions
      });
    }

    const updates = {};
    if (name) updates.name = name;

    await db.from('leads').update(updates).eq('id', lead_id);

    const { error } = await db.from('leads').update({
      name: name || undefined,
      program_interest: goal || undefined
    }).eq('id', lead_id);

    if (error) {
      console.error('Intake update error:', error.message);
    }

    const intakeData = {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, current_weight, height,
      submitted_at: new Date().toISOString()
    };

    const bucket = db.storage.from('intake-forms');
    await bucket.upload(
      `${lead_id}.json`,
      JSON.stringify(intakeData, null, 2),
      { contentType: 'application/json', upsert: true }
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
