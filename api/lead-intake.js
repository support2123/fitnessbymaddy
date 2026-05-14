import supabase from '../lib/supabase.js';
import { jsonResponse } from '../lib/utils.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height,
    } = req.body;

    if (!lead_id && !phone) {
      return jsonResponse(res, 400, { error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .maybeSingle();
      lead = data;
    } else {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .maybeSingle();
      lead = data;
    }

    if (!lead) {
      const { data: newLead } = await supabase
        .from('leads')
        .insert({
          phone: phone || 'unknown',
          name,
          source: 'intake_form',
          status: 'qualified',
          market: 'GLOBAL',
        })
        .select()
        .single();
      lead = newLead;
    }

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        last_msg_at: new Date().toISOString(),
      })
      .eq('id', lead.id);

    // Store intake data as a JSON note in the lead's first_msg field if no better place
    const intakeData = JSON.stringify({
      age, gender, goal, injuries, diet_pref, schedule,
      experience, medical_conditions, current_weight,
      target_weight, height, email, submitted_at: new Date().toISOString(),
    });

    await supabase
      .from('leads')
      .update({ first_msg: intakeData })
      .eq('id', lead.id);

    return jsonResponse(res, 200, { ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal error' });
  }
}
