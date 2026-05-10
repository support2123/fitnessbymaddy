const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, age, gender, height_cm, weight_kg,
      goal, injuries, diet_preference, training_schedule,
      medical_conditions, name, email, phone
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const db = getSupabase();

    const { data: lead } = await db
      .from('leads')
      .select('id, phone')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const { error: insertErr } = await db.from('intake_submissions').insert({
      lead_id,
      age: age ? parseInt(age, 10) : null,
      gender,
      height_cm: height_cm ? parseFloat(height_cm) : null,
      weight_kg: weight_kg ? parseFloat(weight_kg) : null,
      goal,
      injuries,
      diet_preference,
      training_schedule,
      medical_conditions
    });

    if (insertErr) {
      console.error('Intake insert error:', insertErr.message);
      return res.status(500).json({ error: 'Failed to save' });
    }

    if (name || email) {
      const updates = {};
      if (name) updates.name = name;
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    const allText = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
    if (needsEscalation(allText)) {
      await escalateToMaddy(
        'Medical flag in intake form',
        lead.phone,
        allText.slice(0, 300)
      );
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
