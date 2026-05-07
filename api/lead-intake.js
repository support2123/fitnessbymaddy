import { supabase } from './lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const {
    lead_id, name, email, age, gender, goal,
    injuries, diet_preference, schedule,
    current_weight, target_weight, experience_level,
  } = req.body;

  if (!lead_id || !name || !email) {
    return res.status(400).json({ error: 'Missing required fields: lead_id, name, email' });
  }

  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await supabase.from('leads').update({ name }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: age || null,
      gender: gender || null,
      goal: goal || null,
      injuries: injuries || null,
      diet_preference: diet_preference || null,
      schedule: schedule || null,
      current_weight: current_weight || null,
      target_weight: target_weight || null,
      experience_level: experience_level || null,
      submitted_at: new Date().toISOString(),
    };

    await supabase.from('intake_forms').upsert(intakeData, { onConflict: 'lead_id' });

    return res.status(200).json({ status: 'saved', lead_id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
