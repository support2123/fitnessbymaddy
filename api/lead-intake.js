const { supabase } = require('./_lib/supabase');
const { cors, parseBody } = require('./_lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { lead_id, name, email, age, goal, injuries, diet_pref, schedule, phone } = body;

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

    const intakeData = { age, goal, injuries, diet_pref, schedule };

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .single();

    if (existingClient) {
      return res.status(200).json({ ok: true, message: 'Intake already recorded', client_id: existingClient.id });
    }

    return res.status(200).json({
      ok: true,
      message: 'Intake form received. Complete payment to activate your program.',
      lead_id,
      intake: intakeData,
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
