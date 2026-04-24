const { getSupabase } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender, height, weight,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_supplements,
    } = req.body;

    if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (leadErr || !lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (name) await db.from('leads').update({ name }).eq('id', lead_id);

    const intakeData = {
      age, gender, height, weight, goal, injuries,
      diet_pref, schedule, experience, medical_conditions,
      current_supplements, email,
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existingClient) {
      return res.status(200).json({ message: 'Already onboarded', client_id: existingClient.id });
    }

    return res.status(200).json({
      message: 'Intake received',
      lead_id,
      intake: intakeData,
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
