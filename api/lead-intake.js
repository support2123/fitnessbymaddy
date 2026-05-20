const { supabase } = require('./_lib/supabase');
const { hasMedicalFlag, createEscalation } = require('./_lib/escalation');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, phone, name, email, age, gender,
      goal, injuries, diet_pref, schedule, experience, medical,
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const { data: submission, error } = await supabase
      .from('intake_submissions')
      .insert({
        lead_id: lead_id || null,
        phone: phone || null,
        name,
        email,
        age: age ? parseInt(age, 10) : null,
        gender,
        goal,
        injuries,
        diet_pref,
        schedule,
        experience,
        medical,
      })
      .select()
      .single();

    if (error) throw error;

    if (lead_id) {
      await supabase
        .from('leads')
        .update({ name })
        .eq('id', lead_id);
    }

    const fullText = [injuries, medical, goal].filter(Boolean).join(' ');
    if (hasMedicalFlag(fullText)) {
      await createEscalation(
        phone || 'unknown',
        'Medical flag in intake form',
        `Name: ${name}, Issues: ${injuries || ''}, Medical: ${medical || ''}`
      );
    }

    return res.status(200).json({ ok: true, id: submission.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Failed to save intake' });
  }
};
