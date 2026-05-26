import { createClient } from "@supabase/supabase-js";
import { upsertPosition } from "@/lib/supabase/upsertPosition";

export const runtime = "nodejs";

// Only accessible in development
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const results = [];

  // --- Test 1: Greenhouse job upsert ---
  const ghJob = {
    id: "gh-TEST-999999",
    title: "Test Software Engineer",
    company: "Test Corp",
    location: "Remote",
    description: "This is a test job description for a Greenhouse posting.",
    url: "https://example.com/jobs/test-gh",
    isRemote: true,
    employmentType: null,
    salaryMin: null,
    salaryMax: null,
    postedAt: new Date().toISOString(),
    publisher: "Greenhouse",
  };

  const ghPositionId = await upsertPosition(admin, ghJob);

  results.push({
    test: "Greenhouse job upsert",
    passed: ghPositionId !== null,
    positionId: ghPositionId,
    details: ghPositionId ? "Row created and UUID returned" : "FAILED — returned null (table missing or RLS blocked insert)",
  });

  // --- Test 2: Verify the row exists in DB with correct fields ---
  if (ghPositionId) {
    const { data: row, error } = await admin
      .from("positions")
      .select("external_id, source, title, company, is_remote")
      .eq("id", ghPositionId)
      .single();

    const fieldCheck =
      row &&
      row.external_id === ghJob.id &&
      row.source === "greenhouse" &&
      row.title === ghJob.title &&
      row.company === ghJob.company &&
      row.is_remote === true;

    results.push({
      test: "Field mapping verification",
      passed: !error && fieldCheck,
      row,
      details: error ? error.message : fieldCheck ? "All fields mapped correctly" : "Field mismatch — see row",
    });
  }

  // --- Test 3: JSearch job upsert ---
  const jsearchJob = {
    id: "JSEARCH-TEST-999999",
    title: "Test Backend Engineer",
    company: "JSearch Corp",
    location: "New York, NY, US",
    description: "A JSearch API test job description.",
    url: "https://example.com/jobs/test-jsearch",
    isRemote: false,
    employmentType: "FULLTIME",
    salaryMin: 120000,
    salaryMax: 180000,
    postedAt: new Date().toISOString(),
    publisher: "LinkedIn",
  };

  const jsPositionId = await upsertPosition(admin, jsearchJob);

  results.push({
    test: "JSearch job upsert",
    passed: jsPositionId !== null,
    positionId: jsPositionId,
    details: jsPositionId ? "Row created and UUID returned" : "FAILED — returned null",
  });

  if (jsPositionId) {
    const { data: jsRow } = await admin
      .from("positions")
      .select("source, employment_type, salary_min, salary_max")
      .eq("id", jsPositionId)
      .single();

    const jsFieldCheck =
      jsRow?.source === "jsearch" &&
      jsRow?.employment_type === "FULLTIME" &&
      jsRow?.salary_min === 120000 &&
      jsRow?.salary_max === 180000;

    results.push({
      test: "JSearch salary & type mapping",
      passed: jsFieldCheck,
      row: jsRow,
      details: jsFieldCheck ? "Salary and employmentType mapped correctly" : "Field mismatch — see row",
    });
  }

  // --- Test 4: Idempotency — upsert same job twice, should not create a duplicate ---
  const duplicateId = await upsertPosition(admin, ghJob);

  results.push({
    test: "Idempotency (duplicate upsert)",
    passed: duplicateId === ghPositionId,
    details:
      duplicateId === ghPositionId
        ? "Same UUID returned — no duplicate row created"
        : `FAILED — got different UUID: ${duplicateId}`,
  });

  // --- Test 5: Null input guard ---
  const nullResult = await upsertPosition(admin, null);
  const emptyResult = await upsertPosition(admin, {});

  results.push({
    test: "Null/invalid input guard",
    passed: nullResult === null && emptyResult === null,
    details:
      nullResult === null && emptyResult === null
        ? "null and {} both safely returned null"
        : "FAILED — should return null for invalid inputs",
  });

  // --- Cleanup: delete test rows ---
  await admin.from("positions").delete().eq("external_id", "gh-TEST-999999");
  await admin.from("positions").delete().eq("external_id", "JSEARCH-TEST-999999");

  const allPassed = results.every((r) => r.passed);

  return Response.json({
    summary: allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED",
    passed: allPassed,
    results,
  });
}
