const { getSupabase } = require('./lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./lib/whatsapp');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, phone, goal,
      injuries, diet_pref, schedule, medical_conditions,
    } = req.body;

    if (!lead_id || !name || !email) {
      return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy(
        phone || 'unknown',
        'Medical flag in intake form',
        medicalText
      );
    }

    const { error } = await db.from('leads').update({
      name,
      last_msg_at: new Date().toISOString(),
    }).eq('id', lead_id);

    if (error) {
      return res.status(400).json({ error: 'Lead not found' });
    }

    const { error: metaError } = await db.from('lead_intake').upsert({
      lead_id,
      name,
      email,
      age: age ? parseInt(age, 10) : null,
      phone: phone || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'lead_id' });

    if (metaError) {
      console.error('Intake save error:', metaError.message);
      return res.status(500).json({ error: 'Failed to save intake data' });
    }

    return res.status(200).json({ status: 'ok', message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
