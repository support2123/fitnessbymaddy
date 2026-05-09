import supabase from '../lib/supabase.js';
import { cors, parseBody } from '../lib/helpers.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', lead_id).single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
      last_msg_at: new Date().toISOString()
    }).eq('id', lead_id);

    const intakeData = {
      lead_id,
      name,
      email,
      age: age ? parseInt(age, 10) : null,
      goal,
      injuries: injuries || null,
      diet_pref: diet_pref || null,
      schedule: schedule || null,
      phone: phone || lead.phone,
      submitted_at: new Date().toISOString()
    };

    const { error } = await supabase.from('leads').update({
      name,
      program_interest: lead.program_interest || goal
    }).eq('id', lead_id);

    if (error) {
      console.error('Intake update error:', error.message);
      return res.status(500).json({ error: 'Failed to save intake' });
    }

    return res.json({ ok: true, message: 'Intake form submitted successfully' });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}
