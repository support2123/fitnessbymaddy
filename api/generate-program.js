// Flow E — weekly program generator for 12-week clients.
// 1) Pull client + last 2 check-ins. 2) Call Claude. 3) Safety gate.
// 4) Render PDF. 5) Upload to Supabase Storage. 6) Send WhatsApp with signed URL.
// 7) Write programs row (audit trail). Never sends without writing the row first.

import { db } from '../lib/supabase.js';
import { sendWhatsApp, notifyMaddy } from '../lib/whatsapp.js';
import { copyFor, detectMarket } from '../lib/lang.js';
import { isRiskyPlan } from '../lib/escalation.js';
import { generateProgram } from '../lib/claude.js';
import { renderProgramPdf } from '../lib/pdf.js';
import { json, readBody, requireAdmin, isCronRequest } from '../lib/http.js';
import { maskPhone } from '../lib/pii.js';

export default async function handler(req, res) {
  if (!isCronRequest(req) && !requireAdmin(req)) {
    return json(res, 401, { error: 'unauthorized' });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const body = await readBody(req);
  const clientId = body.client_id;
  const weekNo = parseInt(body.week_no, 10);
  if (!clientId || !Number.isFinite(weekNo) || weekNo < 1) {
    return json(res, 400, { error: 'bad_request' });
  }

  const sb = db();
  const { data: client } = await sb.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!client) return json(res, 404, { error: 'client_not_found' });
  if (client.program !== '12wk') {
    return json(res, 400, { error: 'program_not_eligible', program: client.program });
  }
  if (client.status !== 'active') {
    return json(res, 400, { error: 'client_not_active', status: client.status });
  }

  const { data: existing } = await sb.from('programs')
    .select('id, pdf_url, whatsapp_sent_at')
    .eq('client_id', clientId).eq('week_no', weekNo).maybeSingle();
  if (existing?.whatsapp_sent_at) {
    return json(res, 200, { ok: true, already_sent: true, program_id: existing.id });
  }

  // Gather context.
  const { data: checkins } = await sb.from('checkins')
    .select('week_no, weight, waist, compliance_score, energy, issues, next_week_focus, form_submitted_at')
    .eq('client_id', clientId)
    .order('week_no', { ascending: false })
    .limit(2);

  const { data: intakeMsg } = await sb.from('messages')
    .select('meta')
    .eq('phone', client.phone)
    .eq('template_name', 'intake_form')
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const profile = intakeMsg?.meta?.profile || {};

  // 1) Claude generation.
  let plan;
  try {
    plan = await generateProgram({
      client: { ...client, market: detectMarket(client.phone) },
      profile,
      checkins: checkins || [],
      weekNo
    });
  } catch (err) {
    console.error(`[generate-program] claude failed ${maskPhone(client.phone)}`, err?.message);
    await notifyMaddy(`⚠️ Program gen failed for ${client.name || maskPhone(client.phone)} week ${weekNo}: ${err.message?.slice(0, 200)}`);
    return json(res, 502, { error: 'claude_failed' });
  }

  // 2) Safety gate.
  const safety = isRiskyPlan(plan);
  const flagged = !safety.safe || plan.needs_review === true;
  const flagReason = safety.reason || (plan.needs_review ? 'model_flag' : null);

  // 3) Always write audit row first.
  const { data: programRow } = await sb.from('programs').upsert({
    client_id: clientId,
    week_no: weekNo,
    generated_at: new Date().toISOString(),
    workout_plan: plan.workout_plan || null,
    nutrition_plan: plan.nutrition_plan || null,
    notes: plan.notes || null,
    flagged_for_review: flagged,
    flag_reason: flagReason
  }, { onConflict: 'client_id,week_no' }).select().single();

  if (flagged) {
    await notifyMaddy(
      `🛑 Week ${weekNo} plan for ${client.name || maskPhone(client.phone)} flagged: ${flagReason}. Review before send.`
    );
    return json(res, 200, { ok: true, flagged: true, reason: flagReason, program_id: programRow?.id });
  }

  // 4) Render PDF.
  let pdfBuf;
  try {
    pdfBuf = await renderProgramPdf({ client, weekNo, plan });
  } catch (err) {
    console.error('[generate-program] pdf failed', err?.message);
    return json(res, 500, { error: 'pdf_failed' });
  }

  // 5) Upload.
  const path = `${clientId}/week_${weekNo}.pdf`;
  const { error: upErr } = await sb.storage.from('clients').upload(
    path,
    pdfBuf,
    { upsert: true, contentType: 'application/pdf' }
  );
  if (upErr) {
    console.error('[generate-program] upload failed', upErr.message);
    return json(res, 500, { error: 'upload_failed' });
  }

  // 6) Signed URL (14 days).
  const { data: signed, error: signErr } = await sb.storage.from('clients')
    .createSignedUrl(path, 60 * 60 * 24 * 14);
  if (signErr || !signed?.signedUrl) {
    return json(res, 500, { error: 'sign_failed' });
  }
  const pdfUrl = signed.signedUrl;

  await sb.from('programs').update({ pdf_url: pdfUrl }).eq('id', programRow.id);

  // 7) Deliver via WhatsApp.
  const market = detectMarket(client.phone);
  const focus = (plan.notes || '').split(/[.!?]/)[0]?.slice(0, 90) || `Week ${weekNo}`;
  const { ok: sent } = await sendWhatsApp({
    phone: client.phone,
    body: copyFor('program_delivery', market, { week: weekNo, focus, link: pdfUrl }),
    templateName: 'program_delivery',
    campaignName: `program_week_${weekNo}`,
    params: [String(weekNo), focus, pdfUrl],
    mediaUrl: pdfUrl
  });

  if (sent) {
    await sb.from('programs').update({ whatsapp_sent_at: new Date().toISOString() }).eq('id', programRow.id);
  }

  console.log(`[generate-program] ${maskPhone(client.phone)} week ${weekNo} delivered=${sent}`);
  return json(res, 200, { ok: true, program_id: programRow.id, pdf_url: pdfUrl, sent });
}
