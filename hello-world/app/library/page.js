import LibraryEditor from "@/app/components/LibraryEditor";

export const metadata = {
  title: "Tailoring Library",
};

// `tabIndex={-1}` makes the landmark a valid skip-link target (Safari and
// Firefox will not move the caret to a fragment target that cannot hold
// focus) without adding a tab stop of its own. See app/components/SkipLink.js.
export default function LibraryPage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <LibraryEditor />
    </main>
  );
}
