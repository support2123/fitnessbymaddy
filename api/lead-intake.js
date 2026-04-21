const { getSupabase } = require('../lib/supabase');
const { needsEscalation, createEscalation } = require('../lib/escalation');
const { json, cors } = require('../lib/helpers');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, { error: 'POST only' }, 405);

  const db = getSupabase();

  try {
    const {
      lead_id,
      name,
      email,
      age,
      goal,
      injuries,
      diet_pref,
      schedule,
      phone,
    } = req.body;

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

    if (name) {
      await db.from('leads').update({ name }).eq('id', lead.id);
    }

    const intakeText = [goal, injuries, diet_pref, schedule]
      .filter(Boolean)
      .join('; ');
    const escalationReason = needsEscalation(intakeText);
    if (escalationReason) {
      await createEscalation('intake', lead.id, lead.phone, escalationReason);
    }

    const { data: existingClient } = await db
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      await db
        .from('clients')
        .update({
          name: name || undefined,
          email: email || undefined,
          age: age ? parseInt(age, 10) : undefined,
          goal: goal || undefined,
          injuries: injuries || undefined,
          diet_pref: diet_pref || undefined,
          schedule: schedule || undefined,
        })
        .eq('id', existingClient[0].id);

      return json(res, { action: 'updated', client_id: existingClient[0].id });
    }

    return json(res, {
      action: 'intake_saved',
      lead_id: lead.id,
      note: 'Awaiting payment to create client record',
    });
  } catch (err) {
    console.error('Intake error:', err.message);
    return json(res, { error: 'Internal error' }, 500);
  }
};
