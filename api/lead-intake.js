// Public intake form submission. Stores profile against lead OR client.
// Body: { lead, client, name, phone, email, age, goal, injuries, diet_pref, schedule, photos: [] }

const { admin } = require('./_lib/supabase');
const { readJson, ok, err, assertMethod, normalisePhone, marketFromPhone } = require('./_lib/utils');
const escalation = require('./_lib/escalation');

module.exports = async (req, res) => {
  if (!assertMethod(req, res, ['POST'])) return;
  const body = await readJson(req);

  const phone = normalisePhone(body.phone);
  if (!phone) return err(res, 400, 'invalid_phone');
  if (!body.name) return err(res, 400, 'missing_name');

  const sb = admin();

  // Escalate on medical/injury flags mentioned in intake
  const blob = [body.injuries, body.goal, body.notes].filter(Boolean).join(' | ');
  const redFlag = escalation.detect(blob);

  const profile = {
    age: body.age ? Number(body.age) : null,
    goal: body.goal || null,
    injuries: body.injuries || null,
    diet_pref: body.diet_pref || null,
    schedule: body.schedule || null,
    equipment: body.equipment || null,
    photos: Array.isArray(body.photos) ? body.photos : [],
    notes: body.notes || null,
    submitted_at: new Date().toISOString(),
  };

  // Try to attach to a client first (post-purchase intake), else lead
  if (body.client) {
    const { data: client } = await sb.from('clients').select('id,phone,market').eq('id', body.client).maybeSingle();
    if (!client) return err(res, 404, 'client_not_found');
    await sb.from('clients').update({
      name: body.name, email: body.email || null,
      folder_url: client.folder_url || `clients/${client.id}/`,
    }).eq('id', client.id);
    // Store intake as a pseudo week_0 checkin so the program generator has context
    await sb.from('checkins').upsert({
      client_id: client.id, week_no: 0,
      form_submitted_at: new Date().toISOString(),
      issues: body.injuries || null,
      next_week_focus: body.goal || null,
      photos_urls: profile.photos,
    }, { onConflict: 'client_id,week_no' });
    if (redFlag) {
      await escalation.raise({ phone, clientId: client.id, trigger: redFlag, detail: blob });
    }
    return ok(res, { scope: 'client', id: client.id });
  }

  if (body.lead) {
    const { data: lead } = await sb.from('leads').select('id,phone').eq('id', body.lead).maybeSingle();
    if (!lead) return err(res, 404, 'lead_not_found');
    await sb.from('leads').update({
      name: body.name,
      program_interest: body.goal || null,
    }).eq('id', lead.id);
    if (redFlag) {
      await escalation.raise({ phone, leadId: lead.id, trigger: redFlag, detail: blob });
    }
    return ok(res, { scope: 'lead', id: lead.id });
  }

  // No identifier — upsert as fresh lead
  const { data: up } = await sb.from('leads').upsert({
    phone, name: body.name,
    market: marketFromPhone(phone),
    source: body.source || 'intake_form',
    first_msg: `intake: ${body.goal || ''}`.slice(0, 300),
    last_msg_at: new Date().toISOString(),
    program_interest: body.goal || null,
    status: 'qualified',
  }, { onConflict: 'phone' }).select().single();

  if (redFlag && up) {
    await escalation.raise({ phone, leadId: up.id, trigger: redFlag, detail: blob });
  }

  return ok(res, { scope: 'lead', id: up?.id, profile });
};
