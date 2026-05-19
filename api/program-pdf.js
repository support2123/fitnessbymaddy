const { supabase } = require("../lib/supabase");

/**
 * GET /api/program-pdf?id={program_id}
 *
 * Renders a styled, printable HTML page for a client's weekly program.
 * Brand colors: charcoal #2C2C2C, gold #B8965A, cream #FAF8F4
 * Fonts: Cormorant Garamond (headers), DM Sans (body)
 */
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { id } = req.query || {};

    if (!id) {
      return res.status(400).json({ error: "Missing program id" });
    }

    // ── Load program with client info ─────────────────────────────
    const { data: program, error: programErr } = await supabase
      .from("programs")
      .select("*, clients(name, email, goal, program_type)")
      .eq("id", id)
      .single();

    if (programErr || !program) {
      return res.status(404).json({ error: "Program not found" });
    }

    const clientName = program.clients?.name || "Client";
    const clientGoal = program.clients?.goal || "";
    const programType = program.clients?.program_type || "";
    const weekNo = program.week_no;
    const generatedAt = new Date(program.generated_at).toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const workout = program.workout_plan || [];
    const nutrition = program.nutrition_plan || {};
    const notes = program.notes || "";

    // ── Build workout rows ────────────────────────────────────────
    let workoutHtml = "";
    for (const day of workout) {
      workoutHtml += `
        <div class="day-block">
          <div class="day-header">
            <span class="day-name">${escapeHtml(day.day)}</span>
            <span class="day-focus">${escapeHtml(day.focus || "")}</span>
          </div>`;

      if (day.warmup) {
        workoutHtml += `<div class="warmup"><strong>Warm-up:</strong> ${escapeHtml(day.warmup)}</div>`;
      }

      workoutHtml += `
          <table class="exercise-table">
            <thead>
              <tr>
                <th>Exercise</th>
                <th>Sets</th>
                <th>Reps</th>
                <th>Rest</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>`;

      const exercises = day.exercises || [];
      for (const ex of exercises) {
        workoutHtml += `
              <tr>
                <td>${escapeHtml(ex.name || "")}</td>
                <td>${escapeHtml(String(ex.sets || ""))}</td>
                <td>${escapeHtml(String(ex.reps || ""))}</td>
                <td>${escapeHtml(String(ex.rest || ""))}</td>
                <td>${escapeHtml(ex.notes || "")}</td>
              </tr>`;
      }

      workoutHtml += `
            </tbody>
          </table>`;

      if (day.cooldown) {
        workoutHtml += `<div class="cooldown"><strong>Cool-down:</strong> ${escapeHtml(day.cooldown)}</div>`;
      }

      workoutHtml += `</div>`;
    }

    // ── Build nutrition section ────────────────────────────────────
    let nutritionHtml = "";
    if (nutrition.daily_calories || nutrition.protein_g) {
      nutritionHtml += `
        <div class="macro-grid">
          <div class="macro-card">
            <div class="macro-value">${nutrition.daily_calories || "---"}</div>
            <div class="macro-label">Calories</div>
          </div>
          <div class="macro-card">
            <div class="macro-value">${nutrition.protein_g || "---"}g</div>
            <div class="macro-label">Protein</div>
          </div>
          <div class="macro-card">
            <div class="macro-value">${nutrition.carbs_g || "---"}g</div>
            <div class="macro-label">Carbs</div>
          </div>
          <div class="macro-card">
            <div class="macro-value">${nutrition.fat_g || "---"}g</div>
            <div class="macro-label">Fat</div>
          </div>
          <div class="macro-card">
            <div class="macro-value">${nutrition.water_liters || "---"}L</div>
            <div class="macro-label">Water</div>
          </div>
        </div>`;
    }

    const meals = nutrition.meals || [];
    if (meals.length > 0) {
      nutritionHtml += `
        <table class="meal-table">
          <thead>
            <tr>
              <th>Meal</th>
              <th>Suggestion</th>
              <th>Calories</th>
            </tr>
          </thead>
          <tbody>`;

      for (const meal of meals) {
        nutritionHtml += `
            <tr>
              <td><strong>${escapeHtml(meal.meal || "")}</strong></td>
              <td>${escapeHtml(meal.suggestion || "")}</td>
              <td>${meal.calories || ""}</td>
            </tr>`;
      }

      nutritionHtml += `
          </tbody>
        </table>`;
    }

    if (nutrition.notes) {
      nutritionHtml += `<div class="nutrition-notes"><strong>Notes:</strong> ${escapeHtml(nutrition.notes)}</div>`;
    }

    // ── Assemble full HTML ────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Fitness by Maddy - Week ${weekNo} Program</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --charcoal: #2C2C2C;
      --gold: #B8965A;
      --cream: #FAF8F4;
      --gold-light: #D4B87A;
      --charcoal-light: #4A4A4A;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'DM Sans', sans-serif;
      background: var(--cream);
      color: var(--charcoal);
      line-height: 1.6;
      padding: 0;
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 24px;
    }

    /* ── Header ─────────────────────────────────── */
    .header {
      text-align: center;
      padding: 40px 24px;
      background: var(--charcoal);
      color: var(--cream);
      margin-bottom: 32px;
    }

    .header h1 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 2rem;
      font-weight: 700;
      color: var(--gold);
      margin-bottom: 4px;
      letter-spacing: 1px;
    }

    .header .subtitle {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.3rem;
      font-weight: 400;
      color: var(--cream);
      margin-bottom: 16px;
    }

    .header .meta {
      font-size: 0.85rem;
      color: var(--gold-light);
      opacity: 0.85;
    }

    .header .meta span {
      margin: 0 8px;
    }

    /* ── Sections ────────────────────────────────── */
    .section {
      margin-bottom: 32px;
    }

    .section-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--charcoal);
      border-bottom: 2px solid var(--gold);
      padding-bottom: 8px;
      margin-bottom: 20px;
    }

    /* ── Workout blocks ──────────────────────────── */
    .day-block {
      background: #fff;
      border: 1px solid #e8e4dd;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }

    .day-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .day-name {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--charcoal);
    }

    .day-focus {
      font-size: 0.85rem;
      color: var(--gold);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .warmup, .cooldown {
      font-size: 0.85rem;
      color: var(--charcoal-light);
      padding: 8px 12px;
      background: var(--cream);
      border-radius: 4px;
      margin-bottom: 12px;
    }

    .cooldown {
      margin-top: 12px;
      margin-bottom: 0;
    }

    /* ── Tables ───────────────────────────────────── */
    .exercise-table, .meal-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    .exercise-table th, .meal-table th {
      background: var(--charcoal);
      color: var(--cream);
      padding: 10px 12px;
      text-align: left;
      font-weight: 500;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .exercise-table td, .meal-table td {
      padding: 10px 12px;
      border-bottom: 1px solid #e8e4dd;
    }

    .exercise-table tr:last-child td,
    .meal-table tr:last-child td {
      border-bottom: none;
    }

    .exercise-table tr:nth-child(even),
    .meal-table tr:nth-child(even) {
      background: rgba(184, 150, 90, 0.05);
    }

    /* ── Macro grid ───────────────────────────────── */
    .macro-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }

    .macro-card {
      background: #fff;
      border: 1px solid #e8e4dd;
      border-radius: 8px;
      padding: 16px 8px;
      text-align: center;
    }

    .macro-value {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--gold);
    }

    .macro-label {
      font-size: 0.75rem;
      color: var(--charcoal-light);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }

    /* ── Nutrition notes ──────────────────────────── */
    .nutrition-notes {
      font-size: 0.9rem;
      color: var(--charcoal-light);
      padding: 12px 16px;
      background: #fff;
      border-left: 3px solid var(--gold);
      border-radius: 0 8px 8px 0;
      margin-top: 16px;
    }

    /* ── Coaching notes ──────────────────────────── */
    .coaching-notes {
      background: #fff;
      border: 1px solid #e8e4dd;
      border-left: 4px solid var(--gold);
      border-radius: 0 8px 8px 0;
      padding: 20px 24px;
      font-size: 0.95rem;
      color: var(--charcoal-light);
      line-height: 1.7;
    }

    /* ── Footer ──────────────────────────────────── */
    .footer {
      text-align: center;
      padding: 24px;
      font-size: 0.8rem;
      color: var(--charcoal-light);
      border-top: 1px solid #e8e4dd;
      margin-top: 40px;
    }

    .footer .brand {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1rem;
      color: var(--gold);
      font-weight: 600;
    }

    /* ── Meal table in nutrition ──────────────────── */
    .meal-table {
      background: #fff;
      border: 1px solid #e8e4dd;
      border-radius: 8px;
      overflow: hidden;
    }

    /* ── Print styles ────────────────────────────── */
    @media print {
      body {
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .container {
        padding: 0;
        max-width: 100%;
      }

      .header {
        background: var(--charcoal) !important;
        color: var(--cream) !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .header h1 {
        color: var(--gold) !important;
      }

      .day-block {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .section {
        break-inside: avoid;
        page-break-inside: avoid;
      }

      .exercise-table th, .meal-table th {
        background: var(--charcoal) !important;
        color: var(--cream) !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .macro-card {
        border: 1px solid #ccc;
      }

      .footer {
        margin-top: 24px;
      }
    }

    /* ── Responsive ──────────────────────────────── */
    @media (max-width: 600px) {
      .macro-grid {
        grid-template-columns: repeat(3, 1fr);
      }

      .day-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
      }

      .header h1 {
        font-size: 1.5rem;
      }

      .header .subtitle {
        font-size: 1.1rem;
      }

      .exercise-table, .meal-table {
        font-size: 0.8rem;
      }

      .exercise-table th, .exercise-table td,
      .meal-table th, .meal-table td {
        padding: 8px;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Fitness by Maddy</h1>
    <div class="subtitle">Week ${weekNo} Program</div>
    <div class="meta">
      <span>${escapeHtml(clientName)}</span>
      ${clientGoal ? `<span>&bull;</span><span>${escapeHtml(clientGoal)}</span>` : ""}
      <span>&bull;</span>
      <span>${generatedAt}</span>
    </div>
  </div>

  <div class="container">
    ${workoutHtml ? `
    <div class="section">
      <h2 class="section-title">Workout Plan</h2>
      ${workoutHtml}
    </div>` : ""}

    ${nutritionHtml ? `
    <div class="section">
      <h2 class="section-title">Nutrition Plan</h2>
      ${nutritionHtml}
    </div>` : ""}

    ${notes ? `
    <div class="section">
      <h2 class="section-title">Coaching Notes</h2>
      <div class="coaching-notes">${escapeHtml(notes)}</div>
    </div>` : ""}

    <div class="footer">
      <div class="brand">Fitness by Maddy</div>
      <div>This program is personalized for ${escapeHtml(clientName)}. Do not share or redistribute.</div>
    </div>
  </div>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(html);
  } catch (err) {
    console.error("[program-pdf] Unexpected error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
