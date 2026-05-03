const { getSupabase } = require('./lib/supabase');
const { cors, parseBody, normalizePhone } = require('./lib/helpers');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await parseBody(req);
  const db = getSupabase();

  const leadId = body.lead_id;
  const phone = normalizePhone(body.phone);

  if (!leadId && !phone) {
    return res.status(400).json({ error: 'Provide lead_id or phone' });
  }

  const updateData = {};
  if (body.name) updateData.name = body.name;
  if (body.program_interest) updateData.program_interest = body.program_interest;

  if (Object.keys(updateData).length > 0) {
    if (leadId) {
      await db.from('leads').update(updateData).eq('id', leadId);
    } else {
      await db.from('leads').update(updateData).eq('phone', phone);
    }
  }

  const intakeData = {
    lead_id: leadId,
    phone,
    name: body.name,
    email: body.email,
    age: body.age,
    goal: body.goal,
    injuries: body.injuries,
    diet_preference: body.diet_preference,
    schedule: body.schedule,
    experience: body.experience,
    submitted_at: new Date().toISOString()
  };

  const { data: existing } = await db
    .from('clients')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1)
    .single();

  if (existing) {
    await db.from('clients')
      .update({
        name: body.name,
        email: body.email
      })
      .eq('id', existing.id);
  }

  return res.status(200).json({ success: true, message: 'Intake received' });
};
