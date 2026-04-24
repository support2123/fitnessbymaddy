const { getSupabase } = require('../lib/supabase');
const { json, cors } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      phone,
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
    } = req.body || {};

    if (!lead_id && !phone) {
      return json(res, { error: 'lead_id or phone required' }, 400);
    }

    let lead;
    if (lead_id) {
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else {
      const { data } = await db
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .single();
      lead = data;
    }

    if (!lead) {
      return json(res, { error: 'Lead not found' }, 404);
    }

    const updates = {};
    if (name) updates.name = name;
    if (Object.keys(updates).length > 0) {
      await db.from('leads').update(updates).eq('id', lead.id);
    }

    const intakeData = {
      age,
      gender,
      goal,
      injuries,
      diet_preference,
      schedule,
      experience_level,
      current_weight,
      target_weight,
      medical_conditions,
      email,
    };

    const needsEscalation =
      medical_conditions &&
      /injury|pregnant|surgery|heart|diabetes|epilepsy/i.test(medical_conditions);

    if (needsEscalation) {
      await db.from('escalations').insert({
        phone: lead.phone,
        reason: `Medical condition reported in intake: ${medical_conditions.slice(0, 200)}`,
        message_body: JSON.stringify(intakeData),
      });
    }

    await db.from('messages').insert({
      phone: lead.phone,
      direction: 'in',
      body: `Intake form submitted: ${JSON.stringify(intakeData)}`,
      status: 'received',
    });

    return json(res, { ok: true, lead_id: lead.id, escalated: !!needsEscalation });
  } catch (err) {
    console.error('Lead intake error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
