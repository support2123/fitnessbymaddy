const { supabase } = require('../lib/supabase');
const { sendJson, parseBody } = require('../lib/utils');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  try {
    const body = await parseBody(req);
    const {
      lead_id, name, email, age, goal, injuries,
      diet_pref, schedule, experience_level, phone,
    } = body;

    if (!lead_id && !phone) {
      return sendJson(res, 400, { error: 'lead_id or phone required' });
    }

    let lead;
    if (lead_id) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', lead_id)
        .single();
      lead = data;
    } else if (phone) {
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1);
      lead = data?.[0];
    }

    if (!lead) {
      return sendJson(res, 404, { error: 'Lead not found' });
    }

    if (name) {
      await supabase.from('leads').update({ name }).eq('id', lead.id);
    }

    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('lead_id', lead.id)
      .limit(1);

    if (existingClient && existingClient.length > 0) {
      await supabase.from('clients').update({
        name: name || undefined,
        email: email || undefined,
        age: age ? parseInt(age) : undefined,
        goal: goal || undefined,
        injuries: injuries || undefined,
        diet_pref: diet_pref || undefined,
        schedule: schedule || undefined,
        experience_level: experience_level || undefined,
      }).eq('id', existingClient[0].id);

      return sendJson(res, 200, { success: true, client_id: existingClient[0].id, updated: true });
    }

    const { data: client, error } = await supabase
      .from('clients')
      .insert({
        lead_id: lead.id,
        phone: lead.phone,
        name: name || lead.name,
        email,
        program: lead.program_interest,
        age: age ? parseInt(age) : null,
        goal,
        injuries,
        diet_pref,
        schedule,
        experience_level,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;

    return sendJson(res, 200, { success: true, client_id: client.id });
  } catch (err) {
    console.error('[INTAKE] Error:', err.message);
    return sendJson(res, 500, { error: 'Internal error' });
  }
};
