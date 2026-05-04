const { getSupabase } = require('./lib/supabase');
const { cors, parseBody } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id, name, email, phone, age, gender,
    goal, injuries, diet_pref, schedule,
    experience, current_weight, height, medications
  } = body;

  if (!lead_id) return res.status(400).json({ error: 'lead_id required' });

  const db = getSupabase();

  const { data: lead } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  if (name) {
    await db.from('leads').update({ name }).eq('id', lead_id);
  }

  const intakeData = {
    age, gender, goal, injuries, diet_pref,
    schedule, experience, current_weight, height, medications
  };

  const { error } = await db
    .from('leads')
    .update({
      name: name || lead.name,
      first_msg: JSON.stringify(intakeData)
    })
    .eq('id', lead_id);

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ success: true, lead_id });
};
