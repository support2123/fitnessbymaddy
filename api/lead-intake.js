import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getSupabase();
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_preference, schedule,
      medical_conditions, experience_level, current_weight,
      target_weight, height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    let leadId = lead_id;

    if (!leadId && phone) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lead) leadId = lead.id;
    }

    if (leadId) {
      await db.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString()
      }).eq('id', leadId);
    }

    const intakeData = {
      lead_id: leadId,
      name,
      email,
      phone,
      age: age ? parseInt(age, 10) : null,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      medical_conditions,
      experience_level,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      height,
      submitted_at: new Date().toISOString()
    };

    await db.from('intake_forms').insert(intakeData);

    return res.status(200).json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Lead intake error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
