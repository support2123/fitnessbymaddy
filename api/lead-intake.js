const { getSupabase } = require('../lib/supabase');
const { needsEscalation, escalateToMaddy } = require('../lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const db = getSupabase();
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, height
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const combinedNotes = [
      injuries ? `Injuries: ${injuries}` : '',
      medical_conditions ? `Medical: ${medical_conditions}` : '',
      diet_pref ? `Diet: ${diet_pref}` : '',
      schedule ? `Schedule: ${schedule}` : '',
      experience ? `Experience: ${experience}` : '',
      current_weight ? `Weight: ${current_weight}` : '',
      height ? `Height: ${height}` : '',
      age ? `Age: ${age}` : '',
      gender ? `Gender: ${gender}` : ''
    ].filter(Boolean).join(' | ');

    if (needsEscalation(combinedNotes)) {
      await escalateToMaddy({
        reason: 'Medical/injury flag in intake form',
        phone: phone || 'unknown',
        clientName: name,
        message: combinedNotes
      });
    }

    await db.from('leads').update({
      name,
      program_interest: goal
    }).eq('id', lead_id);

    if (email || phone) {
      const updateData = {};
      if (email) updateData.email = email;
      if (name) updateData.name = name;

      const { data: client } = await db
        .from('clients')
        .select('id')
        .eq('lead_id', lead_id)
        .maybeSingle();

      if (client) {
        await db.from('clients').update(updateData).eq('id', client.id);
      }
    }

    return res.status(200).json({ ok: true, message: 'Intake form received' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
