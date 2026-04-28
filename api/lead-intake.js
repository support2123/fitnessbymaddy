const { getSupabase } = require('./_lib/supabase');
const { needsEscalation, escalateToMaddy } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, medical_conditions, diet_preference,
      schedule, experience_level, current_weight, height, notes
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    // Verify lead exists
    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // Update lead with name/email if provided
    const updates = {};
    if (name) updates.name = name;
    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead_id);
    }

    // Check for medical escalation triggers
    const fullText = [injuries, medical_conditions, notes].filter(Boolean).join(' ');
    if (needsEscalation(fullText)) {
      await escalateToMaddy({
        reason: 'Medical/injury flag in intake form',
        phone: lead.phone,
        clientName: name || lead.name,
        message: fullText
      });
    }

    // Store intake data as a JSONB column update or separate table
    // For now, store as notes on the lead until client conversion
    const intakeData = {
      age, gender, goal, injuries, medical_conditions,
      diet_preference, schedule, experience_level,
      current_weight, height, email, notes,
      submitted_at: new Date().toISOString()
    };

    await db.from('leads').update({
      name: name || lead.name,
      intake_data: intakeData
    }).eq('id', lead_id);

    return res.status(200).json({ success: true, message: 'Intake form saved' });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
