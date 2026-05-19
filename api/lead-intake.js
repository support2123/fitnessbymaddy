const { supabase } = require('./_lib/supabase');
const { cors, parseBody } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { lead_id, name, email, phone, age, goal, injuries, diet_pref, schedule, experience } = body;

    if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead_id)
      .single();

    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    await supabase.from('leads').update({
      name: name || lead.name,
    }).eq('id', lead_id);

    const intakeData = { age, goal, injuries, diet_pref, schedule, experience, email };

    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .single();

    if (existing) {
      return res.json({ ok: true, message: 'Intake already submitted' });
    }

    // Store intake as metadata on the lead for now — client record created on payment
    await supabase.from('leads').update({
      name: name || lead.name,
      program_interest: goal || lead.program_interest,
    }).eq('id', lead_id);

    return res.json({ ok: true, message: 'Intake saved' });
  } catch (err) {
    console.error('lead-intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
