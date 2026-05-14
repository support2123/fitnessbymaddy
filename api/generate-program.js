import Anthropic from '@anthropic-ai/sdk';
import supabase from './lib/supabase.js';
import { PROGRAMS } from './lib/constants.js';
import { generateProgramPDF } from './lib/pdf.js';
import { sendMediaMessage } from './lib/whatsapp.js';
import { isHinglishMarket } from './lib/market.js';

const SAFETY_FLAGS = [
  'below 1000 cal', 'under 1000', 'less than 1000',
  'clenbuterol', 'dnp', 'ephedrine', 'steroid', 'sarm',
  'lose 10kg in 1 week', 'lose 20 pounds in a week',
  'extreme cut', 'starvation', 'crash diet',
];

function hasSafetyIssue(text) {
  const lower = text.toLowerCase();
  return SAFETY_FLAGS.some(flag => lower.includes(flag));
}

const SYSTEM_PROMPT = `You are "Program Architect" for FitnessByMaddy, an elite online fitness coaching brand.

Your job: generate a complete, safe, evidence-based weekly workout and nutrition plan for a client.

RULES:
- Never recommend calories below 1200 for women or 1500 for men
- Never recommend banned substances, steroids, SARMs, or any illegal supplement
- Never promise unrealistic timelines (e.g., "lose 10kg in 1 week")
- Base recommendations on the client's current stats, goals, and check-in data
- Progressive overload principles for training
- Sustainable, enjoyable nutrition — no crash diets

OUTPUT FORMAT (strict JSON):
{
  "workout_plan": {
    "days": [
      {
        "day": "Day 1 — Upper Body Push",
        "exercises": [
          { "name": "Bench Press", "sets": "4", "reps": "8-10", "rest": "90s", "notes": "Control the eccentric" }
        ]
      }
    ],
    "weekly_notes": "Focus on mind-muscle connection this week."
  },
  "nutrition_plan": {
    "calories": 2200,
    "macros": { "protein": 180, "carbs": 220, "fats": 70 },
    "meals": [
      { "name": "Meal 1 — Breakfast", "items": ["4 eggs scrambled", "2 toast wheat", "1 banana"] }
    ],
    "notes": "Stay hydrated — minimum 3L water daily."
  },
  "coach_note": "One sentence context note to send with the PDF on WhatsApp."
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_KEY}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { client_id, week_no } = req.body;
    if (!client_id || !week_no) {
      return res.status(400).json({ error: 'client_id and week_no required' });
    }

    const { data: client } = await supabase
      .from('clients')
      .select('*, leads(*)')
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
      .select('workout_plan, nutrition_plan, notes')
      .eq('client_id', client_id)
      .order('week_no', { ascending: false })
      .limit(1)
      .single();

    const clientContext = {
      name: client.name,
      program: client.program,
      week: week_no,
      total_weeks: PROGRAMS[client.program]?.duration_weeks || 12,
      recent_checkins: recentCheckins || [],
      last_program: lastProgram || null,
    };

    const anthropic = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Generate Week ${week_no} program for this client:\n\n${JSON.stringify(clientContext, null, 2)}`,
      }],
    });

    const responseText = response.content[0]?.text || '';

    if (hasSafetyIssue(responseText)) {
      const { sendText } = await import('./lib/whatsapp.js');
      const { MADDY_PHONE } = await import('./lib/constants.js');
      await sendText(MADDY_PHONE,
        `⚠️ SAFETY FLAG: Program generation for ${client.name} (Week ${week_no}) flagged for review. Auto-send halted.`,
        true
      );
      await supabase.from('programs').insert({
        client_id, week_no,
        notes: 'FLAGGED FOR REVIEW — safety issue detected in generated content',
      });
      return res.status(200).json({ flagged: true, message: 'Program flagged for Maddy review' });
    }

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'Failed to parse program JSON from Claude response' });
    }

    const programData = JSON.parse(jsonMatch[0]);
    const { workout_plan, nutrition_plan, coach_note } = programData;

    const programName = PROGRAMS[client.program]?.name || client.program;
    const pdfResult = await generateProgramPDF(
      client_id, client.name || 'Client', week_no, programName,
      workout_plan, nutrition_plan
    );

    const { error: dbError } = await supabase.from('programs').insert({
      client_id,
      week_no,
      pdf_url: pdfResult.pdf_url,
      workout_plan,
      nutrition_plan,
      notes: coach_note || null,
    });

    if (dbError) {
      console.error('Program DB insert error:', dbError.message);
    }

    await sendMediaMessage(
      client.phone,
      pdfResult.pdf_url,
      coach_note || `Here's your Week ${week_no} program! Let's go 💪`
    );

    await supabase.from('programs')
      .update({ whatsapp_sent_at: new Date().toISOString() })
      .eq('client_id', client_id)
      .eq('week_no', week_no);

    return res.status(200).json({
      success: true,
      pdf_url: pdfResult.pdf_url,
      week_no,
    });
  } catch (err) {
    console.error('Program generation error:', err.message);
    return res.status(500).json({ error: 'Failed to generate program' });
  }
}
