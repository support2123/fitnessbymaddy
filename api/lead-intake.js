import supabase from '../lib/supabase.js';
import { jsonResponse, corsHeaders } from '../lib/helpers.js';
import { needsEscalation, escalateToMaddy } from '../lib/escalation.js';

export default async function handler(req, res) {
  if (corsHeaders(req, res)) return;
  if (req.method !== 'POST') return jsonResponse(res, { error: 'POST only' }, 405);

  const { lead_id, name, phone, age, gender, goal, injuries, diet_pref, schedule, experience, medical } = req.body;

  if (!name || !phone) {
    return jsonResponse(res, { error: 'Name and phone are required' }, 400);
  }

  try {
    const { data, error } = await supabase.from('intake_submissions').insert({
      lead_id: lead_id || null,
      phone,
      name,
      age: age ? parseInt(age) : null,
      gender,
      goal,
      injuries,
      diet_pref,
      schedule,
      experience,
      medical,
    }).select().single();

    if (error) throw error;

    if (lead_id) {
      await supabase.from('leads').update({ name }).eq('id', lead_id);
    }

    if (needsEscalation(injuries) || needsEscalation(medical)) {
      await escalateToMaddy('Medical/injury flag in intake form', { phone, name, message: `Injuries: ${injuries || 'none'} | Medical: ${medical || 'none'}` });
    }

    return jsonResponse(res, { ok: true, submission_id: data.id });
  } catch (err) {
    console.error('Intake error:', err.message);
    return jsonResponse(res, { error: 'Submission failed' }, 500);
  }
}
