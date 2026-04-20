const { getSupabase } = require('../lib/supabase');
const { needsEscalation } = require('../lib/helpers');
const { sendEscalation, maskPhone } = require('../lib/whatsapp');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, age, gender,
      goal, injuries, medical_conditions,
      diet_preference, schedule, experience_level,
    } = req.body;

    if (!lead_id) {
      return res.status(400).json({ error: 'Missing lead_id' });
    }

    const { data: lead } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await sendEscalation(
        `Intake form for ${maskPhone(lead.phone)}: medical flag — "${medicalText.slice(0, 200)}". Review before onboarding.`
      );
    }

    return res.status(200).json({
      ok: true,
      message: 'Intake form submitted successfully. We\'ll be in touch shortly!',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
