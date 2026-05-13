import supabase from './lib/supabase.js';
import { needsEscalation, escalateToMaddy } from './lib/escalation.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const {
      lead_id, name, age, phone, email, gender,
      goal, current_activity, injuries, medical_conditions,
      diet_preference, schedule, experience_level
    } = req.body;

    if (!name || !lead_id) {
      return res.status(400).json({ error: 'Name and lead_id are required' });
    }

    const medicalText = [injuries, medical_conditions].filter(Boolean).join(' ');
    if (needsEscalation(medicalText)) {
      await escalateToMaddy('Medical flag in intake form', phone || '', medicalText);
    }

    const { data, error } = await supabase.from('intake_forms').insert({
      lead_id,
      name,
      age: age ? parseInt(age) : null,
      phone,
      email,
      gender,
      goal,
      current_activity,
      injuries,
      medical_conditions,
      diet_preference,
      schedule,
      experience_level
    }).select().single();

    if (error) throw error;

    if (name || email) {
      const updates = {};
      if (name) updates.name = name;
      await supabase.from('leads').update(updates).eq('id', lead_id);
    }

    return res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Intake error:', err);
    return res.status(500).json({ error: 'Failed to save intake form' });
  }
}
