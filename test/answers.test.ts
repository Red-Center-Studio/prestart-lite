import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { check, checkPhoto, checkResult, defect, vehicle } from "../src/db/schema";
import { submitCheck, worstOf, type ItemAnswer, type SubmitInput } from "../src/services/checks";
import { readAnswers } from "../src/routes/check";
import { db, location, makeItems, makeUser, makeVehicle, signedIn } from "./helpers";

const input = (overrides: Partial<SubmitInput> & Pick<SubmitInput, "vehicleId">): SubmitInput => ({
  submissionId: crypto.randomUUID(),
  odometer: 1500,
  ok: [],
  notes: "",
  severity: "minor",
  confirmLower: false,
  reportAnyway: false,
  ...overrides,
});

const pass = (itemId: string): ItemAnswer => ({ itemId, status: "pass", note: "", severity: "minor" });
const jpeg = (name = "p.jpg") => new File([new Uint8Array([255, 216, 255, 0])], name, { type: "image/jpeg" });

describe("Pass, Fail and N/A answers", () => {
  it("raises one defect per failed item with its own note and severity", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const [doors, lights, tow] = await makeItems(["Doors", "Lights", "Tow bar"]);
    const res = await submitCheck(
      db(),
      driver,
      input({
        vehicleId: v,
        answers: [
          { itemId: doors ?? "", status: "fail", note: "Rear doors missing", severity: "major" },
          { itemId: lights ?? "", status: "fail", note: "Number plate light out", severity: "minor" },
          { itemId: tow ?? "", status: "na", note: "", severity: "minor" },
        ],
      }),
    );
    expect(res.kind).toBe("saved");
    if (res.kind !== "saved") return;
    expect(res.passed).toBe(false);
    expect(res.worst).toBe("major");
    expect(res.offRoad).toBe(false);
    expect(res.defectIds).toHaveLength(2);

    const defects = await db().select().from(defect).where(eq(defect.checkId, res.checkId)).all();
    expect(defects.map((d) => [d.description, d.severity]).sort()).toEqual([
      ["Doors: Rear doors missing", "major"],
      ["Lights: Number plate light out", "minor"],
    ]);
    const results = await db().select().from(checkResult).where(eq(checkResult.checkId, res.checkId)).all();
    expect(results.find((r) => r.checklistItemId === tow)).toMatchObject({ status: "na", ok: true, severity: null });
    const doorResult = results.find((r) => r.checklistItemId === doors);
    expect(doorResult).toMatchObject({ status: "fail", ok: false, note: "Rear doors missing", severity: "major" });
    expect(defects.find((d) => d.severity === "major")?.checkResultId).toBe(doorResult?.id);
    // A major fault means "get it checked", not "off road": only critical faults take a vehicle off the road.
    expect((await db().select().from(vehicle).where(eq(vehicle.id, v)).get())?.status).toBe("in_service");
  });

  it("takes the vehicle off road when any failed item is critical", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const [a, b] = await makeItems(["Brakes", "Mirrors"]);
    const res = await submitCheck(
      db(),
      driver,
      input({
        vehicleId: v,
        answers: [
          { itemId: a ?? "", status: "fail", note: "Pedal to the floor", severity: "critical" },
          { itemId: b ?? "", status: "fail", note: "Cracked", severity: "minor" },
        ],
      }),
    );
    expect(res.kind === "saved" && res.offRoad && res.worst === "critical").toBe(true);
    expect((await db().select().from(vehicle).where(eq(vehicle.id, v)).get())?.status).toBe("off_road");
  });

  it("refuses a check with an unanswered item, or a failed item with no description", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const [a, b] = await makeItems(["Tyres", "Horn"]);
    const missing = await submitCheck(db(), driver, input({ vehicleId: v, answers: [pass(a ?? "")] }));
    expect(missing).toEqual({ kind: "error", message: "Answer every item before you submit. Not answered: Horn." });
    const noNote = await submitCheck(
      db(),
      driver,
      input({
        vehicleId: v,
        answers: [pass(a ?? ""), { itemId: b ?? "", status: "fail", note: " ", severity: "minor" }],
      }),
    );
    expect(noNote.kind).toBe("error");
    if (noNote.kind === "error") expect(noNote.message).toContain("Horn");
    // The driver must choose how serious a fault is; it is never assumed to be minor.
    const noSeverity = await submitCheck(
      db(),
      driver,
      input({
        vehicleId: v,
        answers: [pass(a ?? ""), { itemId: b ?? "", status: "fail", note: "Not working", severity: null }],
      }),
    );
    expect(noSeverity).toEqual({ kind: "error", message: "Choose how serious it is for: Horn." });
    expect(await db().select().from(check).all()).toHaveLength(0);
  });

  it("stores photos for each failed item and for the whole check", async () => {
    const driver = await makeUser("driver");
    const v = await makeVehicle();
    const [a, b] = await makeItems(["Body", "Glass"]);
    const res = await submitCheck(
      db(),
      driver,
      input({
        vehicleId: v,
        answers: [{ itemId: a ?? "", status: "fail", note: "Dent in door", severity: "minor" }, pass(b ?? "")],
      }),
      {
        bucket: env.PHOTOS,
        overall: [jpeg("all.jpg")],
        // Photos for an item that passed are ignored.
        byItem: new Map([
          [a ?? "", [jpeg(), jpeg()]],
          [b ?? "", [jpeg()]],
        ]),
      },
    );
    expect(res.kind).toBe("saved");
    if (res.kind !== "saved") return;
    const photos = await db().select().from(checkPhoto).where(eq(checkPhoto.checkId, res.checkId)).all();
    expect(photos).toHaveLength(3);
    const failedResult = await db()
      .select()
      .from(checkResult)
      .where(eq(checkResult.checklistItemId, a ?? ""))
      .get();
    expect(photos.filter((p) => p.checkResultId === failedResult?.id)).toHaveLength(2);
    const d = await db().select().from(defect).where(eq(defect.checkId, res.checkId)).get();
    expect(d?.photoKey).toBe(photos.find((p) => p.checkResultId === failedResult?.id)?.key);
    const saved = await db().select().from(check).where(eq(check.id, res.checkId)).get();
    expect(saved?.photoKey).toBe(photos.find((p) => p.checkResultId === null)?.key);
  });

  it("ranks severities", () => {
    expect(worstOf([])).toBeNull();
    expect(worstOf(["minor", "critical", "major"])).toBe("critical");
    expect(worstOf(["minor", "major"])).toBe("major");
  });

  it("reads answers only from well-formed fields", () => {
    const id = crypto.randomUUID();
    const answers = readAnswers({
      [`s_${id}`]: "fail",
      [`n_${id}`]: "Broken",
      [`v_${id}`]: "critical",
      s_notanid: "pass",
      [`s_${crypto.randomUUID()}`]: "maybe",
    });
    expect(answers).toEqual([{ itemId: id, status: "fail", note: "Broken", severity: "critical" }]);
  });
});

describe("what the driver is told after submitting", () => {
  async function submit(answer: (ids: string[]) => Record<string, string>) {
    const v = await makeVehicle({ name: "Troopy" });
    const ids = await makeItems(["Doors", "Lights"]);
    const { browser, user } = await signedIn("driver");
    const res = await browser.post("/check", {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: "1500",
      ...answer(ids),
    });
    expect(res.status).toBe(303);
    const done = await browser.get(location(res).replace("https://prestart.test", ""));
    return { html: await done.text(), browser, user, v, ids };
  }
  const answers = (ids: string[], doors: string, extra: Record<string, string> = {}) => ({
    [`s_${ids[0]}`]: doors,
    [`s_${ids[1]}`]: "pass",
    ...extra,
  });

  it("says drive safe only when everything passed", async () => {
    const { html } = await submit((ids) => answers(ids, "pass"));
    expect(html).toContain("Check passed. Drive safe.");
  });

  it("tells the driver not to drive yet after a major fault, such as missing doors", async () => {
    const { html } = await submit((ids) =>
      answers(ids, "fail", { [`n_${ids[0]}`]: "Rear doors missing", [`v_${ids[0]}`]: "major" }),
    );
    expect(html).toContain("Do not drive yet");
    expect(html).toContain("Tell your supervisor or the workshop now");
    expect(html).toContain("Doors: Rear doors missing");
    expect(html).not.toContain("Drive safe");
  });

  it("tells the driver the vehicle is off road after a critical fault", async () => {
    const { html } = await submit((ids) =>
      answers(ids, "fail", { [`n_${ids[0]}`]: "Door will not latch", [`v_${ids[0]}`]: "critical" }),
    );
    expect(html).toContain("Do not drive this vehicle.");
    expect(html).toContain("Troopy is now off road");
  });

  it("says safe to drive after a minor fault", async () => {
    const { html } = await submit((ids) =>
      answers(ids, "fail", { [`n_${ids[0]}`]: "Scuffed trim", [`v_${ids[0]}`]: "minor" }),
    );
    expect(html).toContain("Check submitted. Safe to drive.");
    expect(html).not.toContain("Drive safe");
  });

  it("keeps the answers and explains when a failed item has no description", async () => {
    const v = await makeVehicle();
    const ids = await makeItems(["Doors", "Lights"]);
    const { browser } = await signedIn("driver");
    const res = await browser.post("/check", {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: "1500",
      [`s_${ids[0]}`]: "fail",
      [`v_${ids[0]}`]: "major",
      [`s_${ids[1]}`]: "pass",
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Say what is wrong with: Doors");
    expect(html).toMatch(new RegExp(`name="s_${ids[0]}" value="fail" checked`));
  });
});

describe("check pages", () => {
  it("shows known faults for the chosen vehicle on the check form", async () => {
    const v = await makeVehicle();
    await makeItems(["Doors"]);
    const reporter = await makeUser("driver");
    await db().insert(defect).values({
      id: crypto.randomUUID(),
      vehicleId: v,
      vehicleName: "Hilux",
      description: "Aircon not cold",
      severity: "minor",
      status: "open",
      reportedById: reporter.id,
      reportedByName: reporter.name,
    });
    const { browser } = await signedIn("driver");
    const html = await (await browser.get(`/check?vehicle=${v}`)).text();
    expect(html).toContain("Known faults on this vehicle");
    expect(html).toContain("Aircon not cold");
  });

  it("shows each answer, note and photo in history, and keeps item photos private", async () => {
    const v = await makeVehicle();
    const ids = await makeItems(["Doors", "Tow bar"]);
    const { browser } = await signedIn("driver");
    const res = await browser.post("/check", {
      submissionId: crypto.randomUUID(),
      vehicleId: v,
      odometer: "1500",
      [`s_${ids[0]}`]: "fail",
      [`n_${ids[0]}`]: "Rear doors missing",
      [`v_${ids[0]}`]: "major",
      [`p_${ids[0]}`]: jpeg(),
      [`s_${ids[1]}`]: "na",
    });
    expect(res.status).toBe(303);
    const checkId = location(res).split("/").pop() ?? "";
    const html = await (await browser.get(`/history/${checkId}`)).text();
    expect(html).toContain("Rear doors missing");
    expect(html).toContain("N/A");
    const photo = await db().select().from(checkPhoto).where(eq(checkPhoto.checkId, checkId)).get();
    expect(photo).toBeTruthy();
    expect(html).toContain(`/photos/item/${photo?.id}`);
    expect((await browser.get(`/photos/item/${photo?.id}`)).status).toBe(200);
    const other = await signedIn("driver");
    expect((await other.browser.get(`/photos/item/${photo?.id}`)).status).toBe(404);
    const workshop = await signedIn("workshop");
    expect((await workshop.browser.get(`/photos/item/${photo?.id}`)).status).toBe(200);
  });
});
