// Generate the next weekly program for a 12wk client.
// Steps: load profile + last 2 checkins -> call Claude -> safety-check -> render PDF
//        -> upload to Supabase Storage -> log in `programs` -> send WhatsApp with context note.

const { admin } = require('./_lib/supabase');
const { sendText } = require('./_lib/aisensy');
const { renderProgramPdf } = require('./_lib/pdf');
const { generatePlan } = require('./_lib/claude');
const { readJson, ok, err, assertMethod, maskPhone } = require('./_lib/utils');
const { campaign, programReadyBody } = require('./_lib/templates');
const escalation = require('./_lib/escalation');

module.exports = async (req, res) => {
  if (!assertMethod(req, res, ['POST'])) return;

  const internalKey = process.env.SUPABASE_SERVICE_KEY || '';
  if (req.headers['x-internal-key'] !== internalKey) return err(res, 401, 'unauthorized');

  const body = await readJson(req);
  if (!body.client_id) return err(res, 400, 'missing_client_id');

  const sb = admin();
  const { data: client } = await sb.from('clients').select('*').eq('id', body.client_id).maybeSingle();
  if (!client) return err(res, 404, 'client_not_found');
  if (client.program !== '12wk') return err(res, 400, 'program_not_eligible');
  if (client.status !== 'active') return err(res, 400, 'client_not_active');

  const { data: checkins } = await sb.from('checkins')
    .select('*').eq('client_id', client.id)
    .order('week_no', { ascending: false }).limit(2);

  const nextWeek = (checkins?.[0]?.week_no || 0) + 1;

  // Skip if already generated
  const { data: existing } = await sb.from('programs')
    .select('id,pdf_url,whatsapp_sent_at,flagged_for_review')
    .eq('client_id', client.id).eq('week_no', nextWeek).maybeSingle();
  if (existing && existing.pdf_url && existing.whatsapp_sent_at) {
    return ok(res, { skipped: true, week_no: nextWeek, program_id: existing.id });
  }

  // Generate + safety check
  let plan, flagged, flag_reason;
  try {
    const result = await generatePlan({ client, checkins: checkins || [] });
    plan = result.plan; flagged = result.flagged; flag_reason = result.flag_reason;
  } catch (e) {
    console.error(`[claude-fail] ${maskPhone(client.phone)} ${e.message || e}`);
    return err(res, 502, 'claude_failure');
  }

  if (flagged) {
    // Persist but DO NOT send
    const { data: prog } = await sb.from('programs').upsert({
      client_id: client.id, week_no: nextWeek,
      workout_plan: plan.workout_plan, nutrition_plan: plan.nutrition_plan,
      notes: plan.coach_notes, flagged_for_review: true, flag_reason,
    }, { onConflict: 'client_id,week_no' }).select().single();

    await escalation.raise({
      phone: client.phone, clientId: client.id,
      trigger: 'program_flagged', detail: flag_reason,
    });
    await escalation.notifyMaddy({
      trigger: 'program_flagged',
      phone: maskPhone(client.phone),
      detail: `Week ${nextWeek} auto-gen flagged: ${flag_reason}. Review in admin.`,
    });
    return ok(res, { flagged: true, flag_reason, program_id: prog?.id });
  }

  // Render PDF
  const pdfBuf = await renderProgramPdf({ client, plan: { ...plan, week_no: nextWeek } });
  const path = `${client.id}/week_${String(nextWeek).padStart(2, '0')}.pdf`;
  const bucket = process.env.SUPABASE_CLIENT_BUCKET || 'clients';
  const up = await sb.storage.from(bucket).upload(path, pdfBuf, {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) {
    console.error(`[pdf-upload-fail] ${up.error.message}`);
    return err(res, 500, 'upload_failed');
  }
  const { data: signed } = await sb.storage.from(bucket).createSignedUrl(path, 60 * 60 * 24 * 14);
  const pdfUrl = signed?.signedUrl || `${process.env.SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;

  // Log
  const { data: progRow } = await sb.from('programs').upsert({
    client_id: client.id, week_no: nextWeek, pdf_url: pdfUrl,
    workout_plan: plan.workout_plan, nutrition_plan: plan.nutrition_plan,
    notes: plan.coach_notes, flagged_for_review: false,
  }, { onConflict: 'client_id,week_no' }).select().single();

  // Send WhatsApp with 1-liner context
  const market = client.market || 'GLOBAL';
  const note = (plan.focus || plan.coach_notes || '').slice(0, 120);
  const msgBody = programReadyBody(market, nextWeek, note) + `\n${pdfUrl}`;
  const sendResult = await sendText({
    to: client.phone, body: msgBody,
    campaignName: campaign('program_ready'),
    userName: client.name || 'there',
    templateParams: [String(nextWeek), note, pdfUrl],
    media: { url: pdfUrl, filename: `Week_${nextWeek}.pdf` },
    bypassRateLimit: true,
  });

  if (sendResult.sent) {
    await sb.from('programs').update({ whatsapp_sent_at: new Date().toISOString() }).eq('id', progRow.id);
  }

  return ok(res, { program_id: progRow?.id, pdf_url: pdfUrl, sent: sendResult.sent });
};
