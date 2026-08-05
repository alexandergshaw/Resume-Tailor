// Practice mode's recording history (D1): save/list/replay/delete one
// recorded-and-analyzed practice answer per row, stored the same way
// lib/supabase/materials.js stores supplementary files — under the
// signed-in user's own folder in the existing `resumes` bucket, which
// already owner-scopes anything under `${userId}/...` via
// `auth.uid()::text = (storage.foldername(name))[1]`. No new bucket, no new
// storage policy. The row itself lives in `public.practice_answers` — see
// supabase/migrations/20260805000000_practice_answers.sql.
//
// Unlike materials.js (which takes an explicit supabase client + userId),
// every function here creates its own client and resolves the signed-in
// user internally — the call sites (a hook mid-answer-flow, a history
// list/detail component) have no client sitting around already, so this is
// the shape that keeps THOSE call sites simplest, per AC-D1-2. Every
// function returns `{ data, error }` (or plain `{ error }` for the
// delete/update helpers, which have no data to hand back) rather than
// throwing — including for "signed out", which is reported as a plain
// error/empty result, never a thrown exception, so a slow or failed save
// can never tear down the answer-recording flow it's called from.

import { createClient } from "@/lib/supabase/client";

const BUCKET = "resumes";
const SUBFOLDER = "practice";
const TABLE = "practice_answers";

// A clip above this is not uploaded — but the rest of the answer (transcript,
// metrics, critique) is still saved; see savePracticeAnswer. 40 MB comfortably
// covers a few minutes of webm/vp9 at practice-answer length while still
// bounding a single upload.
export const MAX_VIDEO_BYTES = 40 * 1024 * 1024;

// How long a replay link stays valid after signedVideoUrl mints it — long
// enough to watch one answer back without the private bucket ever needing a
// public URL.
const SIGNED_URL_TTL_SECONDS = 600;

// The history list's only query shape (AC-D1-1's index) — newest first,
// capped at a sane limit rather than fetching an unbounded practice history.
// Exported so the UI can say the actual number rather than a hard-coded
// copy that could drift from this value (BUG-13).
export const LIST_LIMIT = 200;

function folder(userId) {
  return `${userId}/${SUBFOLDER}`;
}

function extForMime(mimeType) {
  const type = String(mimeType || "").toLowerCase();
  return type.includes("mp4") ? "mp4" : "webm";
}

// The one supported path (a secure context, which getUserMedia already
// requires for practice mode to work at all) always has crypto.randomUUID.
// The fallback below exists only for defensiveness — but `practice_answers.id`
// is a real `uuid` column, so it must still emit a genuine RFC 4122 v4 uuid
// rather than a string that would fail every insert (BUG-9).
function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

// Resolves the signed-in user without ever throwing — a missing session is
// `{ user: null, error: null }`, never a thrown/rejected auth error, so
// every exported function below can treat "signed out" as plain data.
async function currentUser(supabase) {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { user: null, error: error.message || "Could not verify your account." };
    return { user: data?.user || null, error: null };
  } catch (err) {
    return { user: null, error: err?.message || "Could not verify your account." };
  }
}

// Uploads the recorded clip to `${userId}/practice/${id}.<ext>` and inserts
// the matching row, in that order — the id is generated here (client-side)
// so the storage path and the row agree before either exists. `row` is
// whatever of question/questionType/transcript/durationMs/applicationId/
// postingTitle/postingCompany/metrics/critique the caller has; every field
// is optional and defaults to the column's own not-null default.
//
// A missing `blob` is NOT an error: the row is still saved with an empty
// video_path, so an answer recorded in a browser without MediaRecorder (or
// with nothing captured) still appears in the history with its transcript,
// metrics and critique — but `data.videoSkipped` says so plainly (BUG-3),
// with wording specific to that cause, so the caller never reports the same
// flat "saved" confirmation it would for a real recording. A blob over
// MAX_VIDEO_BYTES is likewise not uploaded, reported the same way with its
// own wording — the rest of the answer is still saved either way, never
// silently dropped.
//
// If the upload itself succeeds but the row insert fails: a foreign-key
// violation on `application_id` (the selected posting's application row was
// deleted elsewhere between selection and save) is retried once with
// application_id cleared — the denormalized posting_title/posting_company
// already keep the row readable without it, so losing the whole answer over
// a stale reference would be a worse outcome (BUG-7). Any OTHER insert
// failure removes the just-uploaded object before returning, so it can't be
// orphaned — reachable and deletable by no one — and if THAT cleanup itself
// fails, that failure is folded into the returned error too rather than
// silently discarded (BUG-10).
export async function savePracticeAnswer({
  blob,
  mimeType,
  question,
  questionType,
  transcript,
  durationMs,
  applicationId,
  postingTitle,
  postingCompany,
  metrics,
  critique,
} = {}) {
  try {
    const supabase = createClient();
    const { user, error: userError } = await currentUser(supabase);
    if (userError) return { data: null, error: userError };
    if (!user) return { data: null, error: "You must be signed in to save practice answers." };

    const id = genId();
    let videoPath = "";
    let videoMime = "";
    let videoBytes = null;
    let videoSkipped = "";

    if (blob && blob.size > 0) {
      if (blob.size > MAX_VIDEO_BYTES) {
        videoSkipped = `The recording is over the ${Math.round(MAX_VIDEO_BYTES / (1024 * 1024))} MB limit, so the video was not uploaded — the rest of this answer was still saved.`;
      } else {
        const ext = extForMime(mimeType || blob.type);
        const path = `${folder(user.id)}/${id}.${ext}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, {
          contentType: mimeType || blob.type || undefined,
          upsert: false,
        });
        if (uploadError) {
          return { data: null, error: uploadError.message || "Could not upload this recording." };
        }
        videoPath = path;
        videoMime = mimeType || blob.type || "";
        videoBytes = blob.size;
      }
    } else {
      // BUG-3: no MediaRecorder support, or nothing was captured — distinct
      // from the size-cap case above, so its own wording, but the same
      // "still report it, don't just say plain success" treatment.
      videoSkipped = "No recording was captured for this answer — the rest of the answer was saved without video.";
    }

    const row = {
      id,
      user_id: user.id,
      application_id: applicationId || null,
      posting_title: postingTitle || "",
      posting_company: postingCompany || "",
      question: question || "",
      question_type: questionType || "",
      transcript: transcript || "",
      duration_ms: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
      video_path: videoPath,
      video_mime: videoMime,
      video_bytes: videoBytes,
      metrics: metrics && typeof metrics === "object" ? metrics : {},
      critique: critique && typeof critique === "object" ? critique : {},
    };

    let insertError = (await supabase.from(TABLE).insert(row)).error;
    if (insertError && insertError.code === "23503" && row.application_id) {
      // BUG-7: foreign_key_violation — retry once without the stale
      // reference rather than losing the transcript/metrics/critique/video
      // over an application row that vanished after the posting was picked.
      row.application_id = null;
      insertError = (await supabase.from(TABLE).insert(row)).error;
    }
    if (insertError) {
      if (videoPath) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([videoPath]);
        if (cleanupError) {
          return {
            data: null,
            error: `${insertError.message || "Could not save this answer."} The uploaded video also could not be cleaned up (${cleanupError.message || "storage error"}) and may remain in storage without a history entry.`,
          };
        }
      }
      return { data: null, error: insertError.message || "Could not save this answer." };
    }

    return { data: { id, videoPath, videoSkipped: videoSkipped || "" }, error: null };
  } catch (err) {
    return { data: null, error: err?.message || "Could not save this answer." };
  }
}

// D1: rewrites just the stored critique for an already-saved row — used when
// a Retry (re-judging the SAME already-recorded answer) succeeds AFTER the
// row was already inserted with an empty critique (the "a failed analysis
// must not cost the user their recording" rule in savePracticeAnswer's
// caller). Without this, the history would keep showing "no analysis" for an
// answer the user watched being analyzed successfully (BUG-6) — the row must
// end up matching what the user was actually shown. RLS scopes this to the
// signed-in user's own row exactly like every other function here.
export async function updatePracticeAnswerCritique(id, critique) {
  try {
    if (!id) return { error: "Missing recording id." };
    const supabase = createClient();
    const { user, error: userError } = await currentUser(supabase);
    if (userError) return { error: userError };
    if (!user) return { error: "You must be signed in to update a practice answer." };

    const { error } = await supabase
      .from(TABLE)
      .update({ critique: critique && typeof critique === "object" ? critique : {} })
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return { error: error.message || "Could not update this answer." };
    return { error: null };
  } catch (err) {
    return { error: err?.message || "Could not update this answer." };
  }
}

// The signed-in user's saved answers, newest first — the only query D1's
// history list needs. No signed-in user is not an error (mirrors
// materials.js's listMaterials): the history is just empty.
//
// BUG-13: fetches one row past LIST_LIMIT so truncation is DETECTABLE rather
// than silent — past the cap, older entries (and the storage objects they
// point at) would otherwise become invisible, and therefore undeletable,
// from the UI with no indication why. `truncated` tells the caller to say
// so; pagination itself is out of scope.
export async function listPracticeAnswers() {
  try {
    const supabase = createClient();
    const { user, error: userError } = await currentUser(supabase);
    if (userError) return { data: null, error: userError, truncated: false };
    if (!user) return { data: [], error: null, truncated: false };

    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT + 1);
    if (error) {
      return { data: null, error: error.message || "Could not load your practice history.", truncated: false };
    }

    const rows = data || [];
    const truncated = rows.length > LIST_LIMIT;
    return { data: truncated ? rows.slice(0, LIST_LIMIT) : rows, error: null, truncated };
  } catch (err) {
    return { data: null, error: err?.message || "Could not load your practice history.", truncated: false };
  }
}

// A time-limited signed URL for one saved clip's playback — the bucket is
// private, so a public URL is never an option. Minted on demand (called only
// when a history row's Replay is actually pressed), never at list time.
export async function signedVideoUrl(path) {
  try {
    if (!path) return { data: null, error: "No recording is saved for this answer." };
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return { data: null, error: error?.message || "Could not create a playback link." };
    }
    return { data: data.signedUrl, error: null };
  } catch (err) {
    return { data: null, error: err?.message || "Could not create a playback link." };
  }
}

// Removes the storage object FIRST, and only then the row (BUG-1 — this was
// originally specced the other way around, but that was the spec's own
// defect: the row is the ONLY pointer to the object, so deleting it before
// the object is actually confirmed gone would strand a video the user could
// never see or delete again). A delete either fully succeeds, or it leaves
// the entry untouched so the history keeps listing it and the user can
// retry — never a half-done state where the row is gone but the object
// survives. "Object not found" (it's already gone) counts as success, same
// as a row with no video at all — both skip straight to the row delete.
export async function deletePracticeAnswer(id) {
  try {
    if (!id) return { error: "Missing recording id." };
    const supabase = createClient();
    const { user, error: userError } = await currentUser(supabase);
    if (userError) return { error: userError };
    if (!user) return { error: "You must be signed in to delete a practice answer." };

    const { data: row, error: fetchError } = await supabase
      .from(TABLE)
      .select("video_path")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (fetchError) return { error: fetchError.message || "Could not delete this recording." };
    if (!row) return { error: "That recording could not be found." };

    if (row.video_path) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([row.video_path]);
      const notFound = removeError && /not.?found/i.test(removeError.message || "");
      if (removeError && !notFound) {
        return {
          error: `The video could not be removed, so this entry was kept — you can try deleting it again. (${removeError.message || "storage error"})`,
        };
      }
    }

    const { error: deleteError } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", user.id);
    if (deleteError) {
      return {
        error: `The video was removed, but the history entry itself could not be deleted (${deleteError.message || "database error"}) — try deleting it again.`,
      };
    }

    return { error: null };
  } catch (err) {
    return { error: err?.message || "Could not delete this recording." };
  }
}
