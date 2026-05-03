import supabase from './_lib/supabase.js';
import { jsonResponse, parseBody } from './_lib/helpers.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);

    const {
      lead_id, name, email, phone, age, gender,
      goal, injuries, diet_pref, schedule,
      current_weight, target_weight, experience_level,
    } = body;

    if (!lead_id) return jsonResponse(res, 400, { error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return jsonResponse(res, 404, { error: 'Lead not found' });

    await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        program_interest: lead.program_interest,
      })
      .eq('id', lead_id);

    const intakeData = {
      age, gender, goal, injuries, diet_pref, schedule,
      current_weight, target_weight, experience_level,
    };

    const { error } = await supabase
      .from('leads')
      .update({
        name: name || lead.name,
        first_msg: JSON.stringify(intakeData),
      })
      .eq('id', lead_id);

    if (error) {
      console.error('Intake save error:', error.message);
      return jsonResponse(res, 500, { error: 'Failed to save intake' });
    }

    return jsonResponse(res, 200, {
      success: true,
      message: 'Intake form submitted successfully',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return jsonResponse(res, 500, { error: 'Internal server error' });
  }
}
