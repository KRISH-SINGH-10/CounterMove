import { connection } from "next/server";

// Tells the browser whether to load AG Grid Enterprise. Only when the server has an
// AG_GRID_LICENSE_KEY; otherwise the app stays on AG Grid Community (no watermark).
// AG_STUDIO_LICENSE_KEY licenses AG Studio on the "Ask your disputes" page.
// AG license keys are meant to ship to the browser, like any client license.
export async function GET() {
  await connection();
  const key = process.env.AG_GRID_LICENSE_KEY?.trim();
  const studioKey = process.env.AG_STUDIO_LICENSE_KEY?.trim();
  // AG_STUDIO_TRIAL=1 loads AG Studio without a key (it shows a trial watermark); for
  // development and for recording saved Ask AI runs.
  const studioTrial = !studioKey && process.env.AG_STUDIO_TRIAL === "1";
  return Response.json({ ...(key ? { enterprise: true, key } : { enterprise: false }), ...(studioKey ? { studioKey } : {}), ...(studioTrial ? { studioTrial } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
