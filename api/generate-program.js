const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./_lib/supabase');
const { generateProgramPDF } = require('./_lib/pdf');
const { sendTemplate, notifyMaddy, maskPhone } = require('./_lib/whatsapp');
const { cors, parseBody } = require('./_lib/helpers');

const SYSTEM_PROMPT = `You are "Program Architect" for Fitness by Maddy, an elite online coaching brand.

Generate a weekly training + nutrition plan based on the client data provided.

RULES:
- Never prescribe fewer than 1200 kcal/day for women or 1500 kcal/day for men
- Never recommend banned substances or unproven supplements
- Never promise specific weight-loss timelines
- If the client reports injury or pain, flag it and prescribe only safe alternatives
- For PCOS clients: prioritize insulin-sensitive nutrition, stress management, moderate intensity
- For 40+ clients: prioritize joint health, progressive loading, recovery

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "name": "Day 1 — Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "8-10", "rest": "90s" }
        ]
      }
    ],
    "notes": "optional coach notes"
  },
  "nutrition_plan": {
    "daily_calories": 1800,
    "protein_g": 140,
    "carbs_g": 180,
    "fats_g": 60,
    "meals": [
      {
        "name": "Meal 1 — Breakfast",
        "description": "3 whole eggs scrambled with spinach, 2 toast, 1 banana",
        "macros": { "protein": "25g", "carbs": "45g", "fats": "15g" }
      }
    ]
  },
  "notes": "Coach notes for the week",
  "flagged": false,
  "flag_reason": null
}`;

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const body = await parseBody(req);
    const { client_id, week_no } = body;

    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'Missing client_id or week_no' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single();

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { data: recentCheckins } = await supabase
      .from('checkins')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(2);

    const { data: lastProgram } = await supabase
      .from('programs')
      .select('*')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const userPrompt = `Generate Week ${week_no} program for this client:

CLIENT PROFILE:
- Name: ${client.name || 'Client'}
- Program: ${client.program}
- Started: ${client.program_started_at}
- Week: ${week_no} of ${client.program === '12wk' ? 12 : 6}

${recentCheckins?.length ? `RECENT CHECK-INS:
${recentCheckins.map(c => `Week ${c.week_no}: Weight ${c.weight}kg, Waist ${c.waist}cm, Compliance ${c.compliance_score}/10, Energy ${c.energy}/10, Issues: ${c.issues || 'none'}`).join('\n')}` : 'No previous check-ins (Week 1).'}

${lastProgram ? `LAST WEEK'S FOCUS: ${lastProgram.notes || 'Standard progression'}` : ''}

Generate the next week's workout and nutrition plan with appropriate progression.`;

    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const responseText = message.content[0].text;
    let parsed;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.error('Failed to parse Claude response');
      return res.status(500).json({ error: 'Failed to parse program output' });
    }

    if (parsed.flagged) {
      await notifyMaddy(
        'Program Flagged',
        `${client.name || maskPhone(client.phone)} Week ${week_no}: ${parsed.flag_reason}`
      );
      return res.status(200).json({ ok: true, flagged: true, reason: parsed.flag_reason });
    }

    let pdfUrl = null;
    try {
      pdfUrl = await generateProgramPDF(client, week_no, parsed.workout_plan, parsed.nutrition_plan, parsed.notes);
    } catch (pdfErr) {
      console.error('PDF generation failed:', pdfErr.message);
    }

    const { data: program, error } = await supabase.from('programs').insert({
      client_id,
      week_no: parseInt(week_no),
      pdf_url: pdfUrl,
      workout_plan: parsed.workout_plan,
      nutrition_plan: parsed.nutrition_plan,
      notes: parsed.notes,
    }).select().single();

    if (error) throw error;

    if (pdfUrl) {
      await sendTemplate(client.phone, 'weekly_program', {
        name: client.name || 'there',
        templateParams: [client.name || 'there', `Week ${week_no}`],
        media: { url: pdfUrl, filename: `week_${week_no}_program.pdf` },
      });

      await supabase.from('programs').update({
        whatsapp_sent_at: new Date().toISOString(),
      }).eq('id', program.id);
    }

    return res.status(200).json({ ok: true, program_id: program.id, pdf_url: pdfUrl });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};
