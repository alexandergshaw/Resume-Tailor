// Supplementary materials locker: store/list/download/remove arbitrary user
// files (transcripts, certificates, etc.) under the existing `resumes` bucket at
// `${userId}/materials/`. Download-only — not fed to the AI or tailoring.

const BUCKET = "resumes";
const SUBFOLDER = "materials";

function folder(userId) {
  return `${userId}/${SUBFOLDER}`;
}

// Keep file names safe for a storage key (no path separators), preserving the
// extension so downloads round-trip cleanly.
export function safeMaterialName(name) {
  return (
    String(name || "file")
      .replace(/[\\/]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180) || "file"
  );
}

export async function listMaterials(supabase, userId) {
  if (!userId) return [];
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder(userId), { limit: 200, sortBy: { column: "name", order: "asc" } });
  if (error) {
    console.warn("[materials] list failed:", error.message);
    return [];
  }
  return (data || [])
    .filter((o) => o && o.name && o.name !== ".emptyFolderPlaceholder")
    .map((o) => ({
      name: o.name,
      size: o.metadata?.size ?? null,
      updatedAt: o.updated_at || o.created_at || null,
    }));
}

export async function uploadMaterial(supabase, userId, file) {
  if (!userId || !file) return { error: "Missing file." };
  const name = safeMaterialName(file.name);
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${folder(userId)}/${name}`, file, {
      upsert: true,
      contentType: file.type || undefined,
    });
  return { error: error ? error.message || "Upload failed." : null, name };
}

export async function downloadMaterialBlob(supabase, userId, name) {
  if (!userId || !name) return { error: "Missing file." };
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .download(`${folder(userId)}/${name}`);
  if (error || !data) return { error: error?.message || "Download failed." };
  return { blob: data };
}

export async function removeMaterial(supabase, userId, name) {
  if (!userId || !name) return { error: "Missing file." };
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([`${folder(userId)}/${name}`]);
  return { error: error ? error.message || "Remove failed." : null };
}
