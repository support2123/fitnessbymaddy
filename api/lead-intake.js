const { getSupabase } = require('./lib/supabase');
const { maskPhone } = require('./lib/market');
const { needsEscalation, escalateToMaddy } = require('./lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      medical_conditions, experience_level,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const injuriesText = [injuries, medical_conditions].filter(Boolean).join('; ');
    if (needsEscalation(injuriesText)) {
      await escalateToMaddy('Medical flag on intake form', phone || 'unknown', injuriesText);
    }

    const db = getSupabase();

    const updates = {};
    if (name) updates.name = name;
    if (phone) updates.phone = phone;

    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    const { error } = await db.from('lead_intake').upsert({
      lead_id,
      name,
      email,
      phone,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      medical_conditions,
      experience_level,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'lead_id' });

    if (error) {
      console.error('Intake save error:', maskPhone(phone || ''), error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
