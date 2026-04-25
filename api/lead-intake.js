import { getSupabase } from './_lib/supabase.js';
import { normalizePhone } from './_lib/utils.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const db = getSupabase();

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule, experience,
      medical_conditions, current_weight, target_weight, height
    } = req.body;

    if (!lead_id && !phone) {
      return res.status(400).json({ error: 'lead_id or phone required' });
    }

    const normalizedPhone = phone ? normalizePhone(phone) : null;

    let lead;
    if (lead_id) {
      const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
      lead = data;
    } else if (normalizedPhone) {
      const { data } = await db.from('leads').select('*')
        .eq('phone', normalizedPhone)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      lead = data;
    }

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    await db.from('leads').update({
      name: name || lead.name,
      status: lead.status === 'new' ? 'qualified' : lead.status,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead.id);

    await db.from('intake_forms').insert({
      lead_id: lead.id,
      name,
      email,
      phone: normalizedPhone || lead.phone,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      medical_conditions,
      current_weight: current_weight ? parseFloat(current_weight) : null,
      target_weight: target_weight ? parseFloat(target_weight) : null,
      height
    });

    return res.status(200).json({ ok: true, message: 'Intake form submitted' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
