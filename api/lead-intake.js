const { getSupabase } = require('./_lib/supabase');
const { cors, parseBody } = require('./_lib/utils');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id,
    name,
    email,
    age,
    gender,
    height,
    weight,
    goal,
    injuries,
    diet_preference,
    schedule,
    experience,
    medical_conditions,
  } = body;

  if (!lead_id) return res.status(400).json({ error: 'missing lead_id' });

  const db = getSupabase();

  const { data: lead, error: leadErr } = await db
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .single();

  if (leadErr || !lead) {
    return res.status(404).json({ error: 'lead not found' });
  }

  await db.from('leads').update({
    name: name || lead.name,
  }).eq('id', lead_id);

  const intakeData = {
    age, gender, height, weight, goal,
    injuries, diet_preference, schedule,
    experience, medical_conditions,
  };

  const { error: metaErr } = await db
    .from('leads')
    .update({
      name: name || lead.name,
      first_msg: JSON.stringify(intakeData),
    })
    .eq('id', lead_id);

  if (metaErr) {
    return res.status(500).json({ error: 'failed to save intake' });
  }

  return res.status(200).json({ success: true, lead_id });
};
