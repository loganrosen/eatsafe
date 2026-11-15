import { describe, expect, it } from "vitest";
import {
  detectEvents,
  type InspectionRow,
  type StoredState,
  snapshotsFromRows,
} from "../alertState.js";
import { isAllowedPushEndpoint, parseFollows } from "../api.js";

const CAMIS = "41234567";

function row(date: string, fields: Partial<InspectionRow> = {}): InspectionRow {
  return {
    camis: CAMIS,
    dba: "JOE'S PIZZA",
    inspection_date: `${date}T00:00:00.000`,
    ...fields,
  };
}

function snapshot(rows: InspectionRow[]) {
  const result = snapshotsFromRows(rows).get(CAMIS);
  if (!result) throw new Error("no snapshot");
  return result;
}

function stateFrom(rows: InspectionRow[]): StoredState {
  const s = snapshot(rows);
  return {
    grade: s.grade,
    grade_inspection_date: s.gradeInspectionDate,
    latest_closure_date: s.latestClosureDate,
  };
}

describe("detectEvents", () => {
  const history = [row("2024-01-10", { grade: "A" })];

  it("records a baseline without alerting", () => {
    expect(detectEvents(null, snapshot(history))).toEqual([]);
  });

  it("alerts when a newer inspection records a worse grade", () => {
    const events = detectEvents(
      stateFrom(history),
      snapshot([...history, row("2025-02-01", { grade: "C" })]),
    );
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(`grade:${CAMIS}:2025-02-01`);
    expect(events[0].title).toContain("dropped to C");
    expect(events[0].body).toContain("previously A");
  });

  it("does not alert on improvements or unchanged grades", () => {
    const b = [row("2024-01-10", { grade: "B" })];
    expect(
      detectEvents(
        stateFrom(b),
        snapshot([...b, row("2025-02-01", { grade: "A" })]),
      ),
    ).toEqual([]);
    expect(
      detectEvents(
        stateFrom(history),
        snapshot([...history, row("2025-02-01", { grade: "A" })]),
      ),
    ).toEqual([]);
  });

  it("keeps the last letter grade through pending grades", () => {
    const pending = [...history, row("2025-02-01", { grade: "Z" })];
    const pendingState = stateFrom(pending);
    expect(pendingState.grade).toBe("A");
    expect(detectEvents(stateFrom(history), snapshot(pending))).toEqual([]);

    const events = detectEvents(
      pendingState,
      snapshot([...pending, row("2025-03-01", { grade: "B" })]),
    );
    expect(events.map((e) => e.id)).toEqual([`grade:${CAMIS}:2025-03-01`]);
  });

  it("does not alert when adjudication revises an already-seen inspection", () => {
    const before = [...history, row("2025-02-01", { grade: "A" })];
    const revised = [...history, row("2025-02-01", { grade: "B" })];
    expect(detectEvents(stateFrom(before), snapshot(revised))).toEqual([]);
  });

  it("prefers the better grade when one inspection has conflicting rows", () => {
    const s = snapshot([
      row("2025-02-01", { grade: "B" }),
      row("2025-02-01", { grade: "A" }),
    ]);
    expect(s.grade).toBe("A");
  });

  it("alerts on a new closure, noting a reopening between checks", () => {
    const closedThenReopened = [
      ...history,
      row("2025-02-01", { action: "Establishment Closed by DOHMH." }),
      row("2025-02-03", { action: "Establishment re-opened by DOHMH." }),
    ];
    const events = detectEvents(
      stateFrom(history),
      snapshot(closedThenReopened),
    );
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(`closure:${CAMIS}:2025-02-01`);
    expect(events[0].body).toContain("since reopened");
  });

  it("does not repeat an already-recorded closure", () => {
    const closed = [
      ...history,
      row("2025-02-01", { action: "Establishment Closed by DOHMH." }),
    ];
    const later = [...closed, row("2025-03-01", { grade: "A" })];
    expect(detectEvents(stateFrom(closed), snapshot(later))).toEqual([]);
  });

  it("ignores the never-inspected sentinel date", () => {
    const s = snapshot([row("1900-01-01", { grade: "C" })]);
    expect(s.grade).toBeNull();
    expect(s.name).toBe("JOE'S PIZZA");
  });
});

describe("subscription validation", () => {
  it("only accepts known push service endpoints", () => {
    expect(
      isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"),
    ).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(
      isAllowedPushEndpoint(
        "https://updates.push.services.mozilla.com/wpush/v2/x",
      ),
    ).toBe(true);
    expect(isAllowedPushEndpoint("https://evil.example/push.apple.com")).toBe(
      false,
    );
    expect(isAllowedPushEndpoint("https://push.apple.com.evil.example/x")).toBe(
      false,
    );
    expect(
      isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc"),
    ).toBe(false);
  });

  it("validates and dedupes follows", () => {
    expect(parseFollows(["41234567", "41234567"])).toEqual(["41234567"]);
    expect(() => parseFollows(["1' OR 1=1"])).toThrow();
    expect(() =>
      parseFollows(Array.from({ length: 51 }, (_, i) => String(40000000 + i))),
    ).toThrow();
  });
});
