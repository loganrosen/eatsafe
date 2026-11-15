import type { InspectionRow } from "./alertState.js";

const API = "https://data.cityofnewyork.us/resource/43nn-pn8j.json";
const ROW_LIMIT = 50000;

/**
 * Fetches one row per (inspection, grade, action) for the given restaurants.
 * Grouping drops the per-violation rows, which keeps responses small enough
 * to parse inside the Workers CPU budget.
 */
export async function fetchInspectionRows(
  camisList: string[],
  appToken?: string,
): Promise<InspectionRow[]> {
  const columns = "camis,dba,inspection_date,grade,action";
  const query = new URLSearchParams({
    $select: columns,
    $group: columns,
    $where: `camis in(${camisList.map((c) => `'${c}'`).join(",")}) AND inspection_date >= '2000-01-01T00:00:00.000'`,
    $order: "camis,inspection_date",
    $limit: String(ROW_LIMIT),
  });
  const response = await fetch(`${API}?${query}`, {
    headers: appToken ? { "X-App-Token": appToken } : undefined,
  });
  if (!response.ok) {
    throw new Error(`Socrata returned HTTP ${response.status}`);
  }
  const rows = (await response.json()) as InspectionRow[];
  if (!Array.isArray(rows)) throw new Error("Socrata returned a non-array");
  // A full page means results were truncated; partial history could look like a grade change.
  if (rows.length >= ROW_LIMIT) {
    throw new Error("Socrata response hit the row limit");
  }
  return rows;
}
