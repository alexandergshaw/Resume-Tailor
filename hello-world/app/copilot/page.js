import CopilotClient from "./CopilotClient";

export const metadata = {
  title: "Interview Copilot",
};

// `tabIndex={-1}` makes the landmark a valid skip-link target (Safari and
// Firefox will not move the caret to a fragment target that cannot hold
// focus) without adding a tab stop of its own. See app/components/SkipLink.js.
export default function CopilotPage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <CopilotClient />
    </main>
  );
}
