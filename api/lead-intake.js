const { getSupabase } = require('../lib/supabase');
const { parseBody, json, cors } = require('../lib/utils');
const { needsEscalation, maskPhone } = require('../lib/utils');
const { escalateToMaddy } = require('../lib/escalate');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const body = await parseBody(req);
  const {
    lead_id, name, email, age, gender, height, weight,
    goal, injuries, diet_preference, workout_schedule,
    medical_conditions, experience_level, phone
  } = body;

  if (!lead_id && !phone) {
    return json(res, 400, { error: 'lead_id or phone required' });
  }

  const db = getSupabase();

  let lead;
  if (lead_id) {
    const { data } = await db.from('leads').select('*').eq('id', lead_id).single();
    lead = data;
  } else {
    const { data } = await db.from('leads').select('*').eq('phone', phone).single();
    lead = data;
  }

  if (!lead) {
    return json(res, 404, { error: 'lead not found' });
  }

  const intakeData = {
    name, email, age, gender, height, weight,
    goal, injuries, diet_preference, workout_schedule,
    medical_conditions, experience_level,
  };

  await db.from('leads')
    .update({ name: name || lead.name })
    .eq('id', lead.id);

  const escalationFields = [injuries, medical_conditions, goal].filter(Boolean).join(' ');
  if (needsEscalation(escalationFields)) {
    await escalateToMaddy(
      'Medical/injury flag on intake form',
      `Lead: ${maskPhone(lead.phone)}\nName: ${name}\nInjuries: ${injuries || 'none'}\nMedical: ${medical_conditions || 'none'}`
    );
  }

  const folderPath = `intakes/${lead.id}.json`;
  await db.storage.from('clients').upload(
    folderPath,
    JSON.stringify(intakeData, null, 2),
    { contentType: 'application/json', upsert: true }
  );

  return json(res, 200, { ok: true, lead_id: lead.id });
};
