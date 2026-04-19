import { getSupabase } from '../lib/supabase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, age, phone, goal, injuries,
      diet_pref, schedule, experience, medical_conditions,
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const db = getSupabase();

    let leadId = lead_id;

    if (!leadId && phone) {
      const { data: lead } = await db
        .from('leads')
        .select('id')
        .eq('phone', phone)
        .maybeSingle();

      if (lead) leadId = lead.id;
    }

    if (leadId) {
      await db.from('leads').update({
        name: name || undefined,
        last_msg_at: new Date().toISOString(),
      }).eq('id', leadId);
    }

    const intakeData = {
      lead_id: leadId,
      name,
      email,
      age: parseInt(age) || null,
      phone,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      experience: experience || null,
      medical_conditions: medical_conditions || null,
      submitted_at: new Date().toISOString(),
    };

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', leadId)
      .maybeSingle();

    if (existingClient) {
      return res.status(200).json({ success: true, message: 'Already a client', clientId: existingClient.id });
    }

    return res.status(200).json({
      success: true,
      message: 'Intake received. Complete payment to start your program.',
      leadId,
      intake: intakeData,
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
