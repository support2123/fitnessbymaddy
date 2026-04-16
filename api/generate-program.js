// Generate a weekly program PDF for a 12-week client. Safety-checks Claude
// output, uploads PDF to Supabase Storage, logs in `programs`, sends WhatsApp.
//
// Called from:
//   - Flow C (Exly purchase) for Week 1
//   - Flow D (check-in submit) for Week N+1

import { db } from '../lib/supabase.js';
import { sendWhatsApp } from '../lib/whatsapp.js';
import { render } from '../lib/templates.js';
import { detectMarket } from '../lib/market.js';
import { generatePlan } from '../lib/claude.js';
import { buildProgramPdf } from '../lib/pdf.js';
import { escalate } from '../lib/escalation.js';
import { readJson, json, methodNotAllowed } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');

  // Gate to internal callers + Vercel cron
  const internal = req.headers['x-internal'] === (process.env.CRON_SECRET || '');
  const fromCron = (req.headers['user-agent'] || '').includes('vercel-cron');
  if (!internal && !fromCron && process.env.NODE_ENV === 'production') {
    return json(res, 401, { ok: false, error: 'internal_only' });
  }

  const { client_id, week_no } = await readJson(req);
  if (!client_id || !week_no) return json(res, 400, { ok: false, error: 'missing_params' });

  const { data: c } = await db().from('clients').select('*').eq('id', client_id).maybeSingle();
  if (!c) return json(res, 404, { ok: false, error: 'client_not_found' });
  if (c.program !== '12wk') return json(res, 400, { ok: false, error: 'not_12wk' });
  if (c.status !== 'active') return json(res, 400, { ok: false, error: 'client_not_active' });

  // Pull intake profile from messages audit (lead-intake stores it there)
  const { data: intake } = await db()
    .from('messages').select('meta').eq('phone', c.phone)
    .eq('template_name', 'intake_form').order('sent_at', { ascending: false }).limit(1);
  const profile = intake?.[0]?.meta?.profile || {};

  // Last 2 check-ins
  const { data: checkins } = await db().from('checkins')
    .select('week_no, weight, waist, compliance_score, energy, issues')
    .eq('client_id', c.id).order('week_no', { ascending: false }).limit(2);

  // Generate via Claude
  const { ok, plan, reason, detail } = await generatePlan({
    client: { name: c.name, program: c.program, ...profile },
    checkins: checkins || []
  });

  if (!ok) {
    // Record the flagged program and escalate instead of sending
    await db().from('programs').insert({
      client_id: c.id, week_no, flagged_for_review: true,
      review_reason: `${reason}${detail ? ': ' + detail : ''}`
    });
    await escalate({
      phone: c.phone, clientId: c.id, reason: 'program_generation_flagged',
      context: `week ${week_no}: ${reason}${detail ? ' / ' + detail : ''}`
    });
    return json(res, 200, { ok: false, flagged: true, reason });
  }

  // Build PDF
  const pdfBytes = await buildProgramPdf({ clientName: c.name, weekNo: week_no, plan });

  // Upload to Supabase Storage
  const path = `clients/${c.id}/week_${week_no}.pdf`;
  const { error: upErr } = await db().storage.from('programs').upload(
    path, Buffer.from(pdfBytes),
    { contentType: 'application/pdf', upsert: true }
  );
  if (upErr) {
    console.error('storage upload failed', upErr.message);
    return json(res, 500, { ok: false, error: 'upload_failed' });
  }

  // Signed URL (1 week validity — long enough for the client to re-open)
  const { data: signed } = await db().storage.from('programs')
    .createSignedUrl(path, 7 * 24 * 3600);
  const pdfUrl = signed?.signedUrl;

  await db().from('programs').upsert({
    client_id: c.id, week_no,
    pdf_url: pdfUrl,
    workout_plan: plan.workout, nutrition_plan: plan.nutrition,
    notes: plan.weekly_notes
  }, { onConflict: 'client_id,week_no' });

  // Send WhatsApp with 1-liner + PDF link
  const market = detectMarket(c.phone);
  const t = render('program_delivery', market, {
    weekNo: week_no,
    contextLine: plan.week_focus || ''
  });
  const msg = `${t.body}\n\n${pdfUrl}`;
  const r = await sendWhatsApp({ phone: c.phone, body: msg, templateName: t.name, force: true });

  if (r.sent) {
    await db().from('programs').update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', c.id).eq('week_no', week_no);
  }

  return json(res, 200, { ok: true, week_no, pdf_url: pdfUrl });
}
