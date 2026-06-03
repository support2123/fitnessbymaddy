/**
 * Generate a styled HTML document for a weekly fitness program.
 * Designed to be saved or printed as PDF from the browser.
 *
 * Since Puppeteer is not available on Vercel serverless, this returns
 * an HTML string that can be served with Content-Type: text/html and
 * printed to PDF by the client (or by a dedicated PDF service).
 *
 * @param {string} clientName - Client's display name
 * @param {number} weekNo - Week number (1-12)
 * @param {object} workoutPlan - Workout plan data
 * @param {string} workoutPlan.title - e.g. "Upper Body Strength"
 * @param {Array<{day: string, exercises: Array<{name: string, sets: string, reps: string, notes?: string}>}>} workoutPlan.days
 * @param {object} nutritionPlan - Nutrition plan data
 * @param {string} nutritionPlan.title - e.g. "1600 cal High Protein"
 * @param {Array<{meal: string, items: string, calories?: number}>} nutritionPlan.meals
 * @returns {string} Complete HTML document string
 */
function generateProgramPDF(clientName, weekNo, workoutPlan, nutritionPlan) {
  const brandBlack = '#2C2C2C';
  const brandGold = '#B8965A';
  const white = '#FFFFFF';
  const lightGray = '#F5F5F5';

  const workoutRows = (workoutPlan.days || [])
    .map((day) => {
      const exerciseRows = (day.exercises || [])
        .map(
          (ex) => `
          <tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E0E0E0; font-family: 'DM Sans', sans-serif; font-size: 14px;">
              ${escapeHtml(ex.name)}
            </td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E0E0E0; font-family: 'DM Sans', sans-serif; font-size: 14px; text-align: center;">
              ${escapeHtml(ex.sets)}
            </td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E0E0E0; font-family: 'DM Sans', sans-serif; font-size: 14px; text-align: center;">
              ${escapeHtml(ex.reps)}
            </td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #E0E0E0; font-family: 'DM Sans', sans-serif; font-size: 14px; color: #666;">
              ${escapeHtml(ex.notes || '—')}
            </td>
          </tr>`
        )
        .join('');

      return `
        <div style="margin-bottom: 20px;">
          <h3 style="font-family: 'Bebas Neue', sans-serif; font-size: 20px; color: ${brandGold}; margin: 0 0 8px 0; letter-spacing: 1px;">
            ${escapeHtml(day.day)}
          </h3>
          <table style="width: 100%; border-collapse: collapse; background: ${white}; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
            <thead>
              <tr style="background: ${brandBlack}; color: ${white};">
                <th style="padding: 10px 12px; text-align: left; font-family: 'DM Sans', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Exercise</th>
                <th style="padding: 10px 12px; text-align: center; font-family: 'DM Sans', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Sets</th>
                <th style="padding: 10px 12px; text-align: center; font-family: 'DM Sans', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Reps</th>
                <th style="padding: 10px 12px; text-align: left; font-family: 'DM Sans', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Notes</th>
              </tr>
            </thead>
            <tbody>
              ${exerciseRows}
            </tbody>
          </table>
        </div>`;
    })
    .join('');

  const nutritionRows = (nutritionPlan.meals || [])
    .map(
      (meal) => `
      <tr>
        <td style="padding: 10px 14px; border-bottom: 1px solid #E0E0E0; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; color: ${brandBlack}; width: 120px; vertical-align: top;">
          ${escapeHtml(meal.meal)}
        </td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #E0E0E0; font-family: 'DM Sans', sans-serif; font-size: 14px; color: #333;">
          ${escapeHtml(meal.items)}
        </td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #E0E0E0; font-family: 'DM Sans', sans-serif; font-size: 14px; text-align: center; color: ${brandGold}; font-weight: 600; width: 80px;">
          ${meal.calories ? meal.calories + ' cal' : '—'}
        </td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FitnessByMaddy — Week ${weekNo} Program for ${escapeHtml(clientName)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    @media print {
      body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-break { page-break-before: always; }
      .no-print { display: none; }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: ${lightGray};
      font-family: 'DM Sans', Arial, sans-serif;
      color: ${brandBlack};
    }
  </style>
</head>
<body>

  <!-- Print button (hidden on print) -->
  <div class="no-print" style="text-align: center; padding: 16px;">
    <button onclick="window.print()" style="
      font-family: 'DM Sans', sans-serif;
      font-size: 14px;
      font-weight: 600;
      padding: 10px 28px;
      background: ${brandGold};
      color: ${white};
      border: none;
      border-radius: 6px;
      cursor: pointer;
      letter-spacing: 0.5px;
    ">Save as PDF / Print</button>
  </div>

  <div style="max-width: 800px; margin: 0 auto; padding: 20px;">

    <!-- Header -->
    <div style="background: ${brandBlack}; border-radius: 10px; padding: 36px 32px; text-align: center; margin-bottom: 28px;">
      <h1 style="font-family: 'Bebas Neue', sans-serif; font-size: 42px; color: ${brandGold}; margin: 0 0 4px 0; letter-spacing: 3px;">
        FITNESSBYMADDY
      </h1>
      <p style="font-family: 'DM Sans', sans-serif; font-size: 14px; color: #AAAAAA; margin: 0 0 20px 0; letter-spacing: 1px;">
        YOUR PERSONALIZED PROGRAM
      </p>
      <div style="display: inline-block; background: ${brandGold}; color: ${brandBlack}; padding: 8px 24px; border-radius: 20px; font-family: 'DM Sans', sans-serif; font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">
        WEEK ${weekNo} &mdash; ${escapeHtml(clientName.toUpperCase())}
      </div>
    </div>

    <!-- Workout Section -->
    <div style="margin-bottom: 32px;">
      <div style="display: flex; align-items: center; margin-bottom: 16px;">
        <div style="width: 4px; height: 28px; background: ${brandGold}; border-radius: 2px; margin-right: 12px;"></div>
        <h2 style="font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: ${brandBlack}; margin: 0; letter-spacing: 2px;">
          WORKOUT PLAN
        </h2>
      </div>
      ${workoutPlan.title ? `<p style="font-family: 'DM Sans', sans-serif; font-size: 15px; color: #666; margin: 0 0 16px 16px;">${escapeHtml(workoutPlan.title)}</p>` : ''}
      ${workoutRows}
    </div>

    <!-- Page break for print -->
    <div class="page-break"></div>

    <!-- Nutrition Section -->
    <div style="margin-bottom: 32px;">
      <div style="display: flex; align-items: center; margin-bottom: 16px;">
        <div style="width: 4px; height: 28px; background: ${brandGold}; border-radius: 2px; margin-right: 12px;"></div>
        <h2 style="font-family: 'Bebas Neue', sans-serif; font-size: 28px; color: ${brandBlack}; margin: 0; letter-spacing: 2px;">
          NUTRITION PLAN
        </h2>
      </div>
      ${nutritionPlan.title ? `<p style="font-family: 'DM Sans', sans-serif; font-size: 15px; color: #666; margin: 0 0 16px 16px;">${escapeHtml(nutritionPlan.title)}</p>` : ''}
      <table style="width: 100%; border-collapse: collapse; background: ${white}; border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
        <thead>
          <tr style="background: ${brandBlack}; color: ${white};">
            <th style="padding: 10px 14px; text-align: left; font-family: 'DM Sans', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Meal</th>
            <th style="padding: 10px 14px; text-align: left; font-family: 'DM Sans', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Items</th>
            <th style="padding: 10px 14px; text-align: center; font-family: 'DM Sans', sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">Calories</th>
          </tr>
        </thead>
        <tbody>
          ${nutritionRows}
        </tbody>
      </table>
    </div>

    <!-- Footer -->
    <div style="text-align: center; padding: 24px 0 12px 0; border-top: 2px solid ${brandGold};">
      <p style="font-family: 'DM Sans', sans-serif; font-size: 12px; color: #999; margin: 0;">
        Generated by FitnessByMaddy &bull; This plan is personalized for ${escapeHtml(clientName)} &bull; Do not redistribute
      </p>
    </div>

  </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters to prevent XSS in generated documents.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { generateProgramPDF };
