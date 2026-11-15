export type LetterGrade = "A" | "B" | "C";

const GRADE_RANK: Record<LetterGrade, number> = { A: 0, B: 1, C: 2 };

export interface InspectionRow {
  camis: string;
  dba?: string;
  inspection_date?: string;
  grade?: string;
  action?: string;
}

export interface RestaurantSnapshot {
  camis: string;
  name: string;
  grade: LetterGrade | null;
  gradeInspectionDate: string | null;
  latestClosureDate: string | null;
  reopenedSinceClosure: boolean;
}

export interface StoredState {
  grade: string | null;
  grade_inspection_date: string | null;
  latest_closure_date: string | null;
}

export interface AlertEvent {
  id: string;
  camis: string;
  title: string;
  body: string;
}

function isLetterGrade(grade: string | null | undefined): grade is LetterGrade {
  return grade === "A" || grade === "B" || grade === "C";
}

function isClosedAction(action: string | undefined): boolean {
  return action?.toLowerCase().includes("closed") ?? false;
}

function isReopenedAction(action: string | undefined): boolean {
  const lower = action?.toLowerCase() ?? "";
  return lower.includes("re-opened") || lower.includes("reopened");
}

// Socrata floating timestamps ("2024-03-05T00:00:00.000") sort lexically.
// Dates before 2000 are the dataset's "never inspected" sentinel.
function dateKey(date: string | undefined): string | null {
  if (!date || date < "2000") return null;
  return date.slice(0, 10);
}

export function snapshotsFromRows(
  rows: InspectionRow[],
): Map<string, RestaurantSnapshot> {
  const byCamis = new Map<string, InspectionRow[]>();
  for (const row of rows) {
    if (!row.camis) continue;
    const list = byCamis.get(row.camis);
    if (list) list.push(row);
    else byCamis.set(row.camis, [row]);
  }

  const snapshots = new Map<string, RestaurantSnapshot>();
  for (const [camis, restaurantRows] of byCamis) {
    let name = "";
    let nameDate = "";
    let grade: LetterGrade | null = null;
    let gradeDate: string | null = null;
    let closureDate: string | null = null;
    let reopenDate: string | null = null;

    for (const row of restaurantRows) {
      const date = dateKey(row.inspection_date);
      if (row.dba && (date ?? "") >= nameDate) {
        name = row.dba;
        nameDate = date ?? "";
      }
      if (!date) continue;

      if (isLetterGrade(row.grade)) {
        // Same-day conflicts keep the better grade so a stray row can't trigger an alert.
        if (
          !gradeDate ||
          date > gradeDate ||
          (date === gradeDate &&
            grade &&
            GRADE_RANK[row.grade] < GRADE_RANK[grade])
        ) {
          grade = row.grade;
          gradeDate = date;
        }
      }
      if (isClosedAction(row.action) && (!closureDate || date > closureDate)) {
        closureDate = date;
      }
      if (isReopenedAction(row.action) && (!reopenDate || date > reopenDate)) {
        reopenDate = date;
      }
    }

    snapshots.set(camis, {
      camis,
      name,
      grade,
      gradeInspectionDate: gradeDate,
      latestClosureDate: closureDate,
      reopenedSinceClosure:
        closureDate != null && reopenDate != null && reopenDate >= closureDate,
    });
  }
  return snapshots;
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** With no stored baseline this returns nothing; the first check only records state. */
export function detectEvents(
  previous: StoredState | null,
  next: RestaurantSnapshot,
): AlertEvent[] {
  if (!previous) return [];
  const events: AlertEvent[] = [];
  const name = next.name || "A restaurant you follow";

  if (
    next.latestClosureDate &&
    (!previous.latest_closure_date ||
      next.latestClosureDate > previous.latest_closure_date)
  ) {
    events.push({
      id: `closure:${next.camis}:${next.latestClosureDate}`,
      camis: next.camis,
      title: `${name} was closed by the Health Department`,
      body: next.reopenedSinceClosure
        ? `Closed after an inspection on ${formatDate(next.latestClosureDate)}. It has since reopened.`
        : `Closed after an inspection on ${formatDate(next.latestClosureDate)}.`,
    });
  }

  const previousGrade = isLetterGrade(previous.grade) ? previous.grade : null;
  if (
    previousGrade &&
    next.grade &&
    next.gradeInspectionDate &&
    previous.grade_inspection_date &&
    next.gradeInspectionDate > previous.grade_inspection_date &&
    GRADE_RANK[next.grade] > GRADE_RANK[previousGrade]
  ) {
    events.push({
      id: `grade:${next.camis}:${next.gradeInspectionDate}`,
      camis: next.camis,
      title: `${name}'s grade dropped to ${next.grade}`,
      body: `The Health Department recorded a ${next.grade} (previously ${previousGrade}) for an inspection on ${formatDate(next.gradeInspectionDate)}.`,
    });
  }

  return events;
}
