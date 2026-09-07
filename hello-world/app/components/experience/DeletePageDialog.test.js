// @vitest-environment jsdom
//
// The delete dialog's own header already states its job: it "must name the
// blast radius, not just ask 'are you sure?'". Until now that radius was
// sub-pages only, and that was the whole truth.
//
// It stopped being the whole truth the moment experience_page_summaries and
// experience_page_questions started carrying content. Deleting a page now
// destroys, in one click:
//
//   * the stored summary and the ENTIRE question history for that page and
//     every page beneath it (the two composite FKs' `on delete cascade`), and
//   * the stored summary and question history for every ANCESTOR scope,
//     including the whole-knowledge-base scope, which the page-delete route
//     purges because no cascade can reach them
//     (supabase/migrations/20260906010000_experience_knowledge.sql's header).
//
// A question history is the one thing in this feature the user AUTHORED and
// cannot regenerate. This dialog is the only place they can learn it is about
// to go, so this file asserts the sentence exists, and asserts it in the real
// numbers rather than in words like "some" or "any related data".
//
// Written before the clause exists.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import DeletePageDialog from "./DeletePageDialog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

// A production-shaped page: parent_id present on every row. With it missing,
// tree.js coerces every page to a root, every subtree collapses to one page,
// and a dialog that computed nothing at all would still read correctly.
function page(id, parentId, title, position = 0) {
  return {
    id,
    parent_id: parentId,
    title,
    body: "",
    position,
    archived_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

//  Platform
//  └─ Payments
//     └─ Ledger
//        ├─ Refunds
//        └─ Chargebacks
//  Unrelated
const PAGES = [
  page("platform", null, "Platform"),
  page("payments", "platform", "Payments"),
  page("ledger", "payments", "Ledger"),
  page("refunds", "ledger", "Refunds"),
  page("chargebacks", "ledger", "Chargebacks", 1),
  page("unrelated", null, "Unrelated", 1),
];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(props) {
  await act(async () => {
    root.render(
      createElement(DeletePageDialog, {
        open: true,
        pages: PAGES,
        onClose: vi.fn(),
        onConfirm: vi.fn(),
        ...props,
      }),
    );
  });
}

// MUI's Dialog portals onto document.body, outside `container`.
function dialogText() {
  const el = document.querySelector('[role="dialog"]');
  return el ? el.textContent : "";
}

describe("DeletePageDialog still names the page blast radius it always named", () => {
  it("[control] names the page and its sub-page count", async () => {
    await render({ page: PAGES.find((p) => p.id === "ledger") });
    expect(dialogText()).toContain("Delete “Ledger” and its 2 sub-pages?");
    expect(dialogText()).toContain("This cannot be undone.");
  });

  it("[control] a leaf page has no sub-page clause", async () => {
    await render({ page: PAGES.find((p) => p.id === "refunds") });
    expect(dialogText()).toContain("Delete “Refunds”?");
    expect(dialogText()).not.toContain("sub-page");
  });

  it("[control] renders nothing at all with no page selected", async () => {
    await render({ page: null, open: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("DeletePageDialog names what the knowledge panel is about to lose", () => {
  it("says the summaries and the question history go, in those words", async () => {
    await render({ page: PAGES.find((p) => p.id === "ledger") });
    const text = dialogText();
    expect(text).toMatch(/summary/i);
    expect(text).toMatch(/question history/i);
  });

  it("counts the pages that lose their OWN summary and history: the page plus its sub-pages", async () => {
    // Ledger + Refunds + Chargebacks = 3.
    await render({ page: PAGES.find((p) => p.id === "ledger") });
    expect(dialogText()).toContain("those 3 pages");
  });

  it("counts the ANCESTOR scopes that get cleared, and names the whole knowledge base separately", async () => {
    // Ledger's strict ancestors are Payments and Platform. Plus the root
    // scope, which is the one no FK cascade can ever reach.
    await render({ page: PAGES.find((p) => p.id === "ledger") });
    const text = dialogText();
    expect(text).toContain("the 2 pages above them");
    expect(text).toContain("your whole knowledge base");
    expect(text).toContain("3 more");
  });

  it("does not count the deleted page itself as one of the pages above it", async () => {
    // The off-by-one an implementation written from `breadcrumbFor(id).length`
    // produces, and the one a reader cannot catch from the sentence alone.
    await render({ page: PAGES.find((p) => p.id === "payments") });
    expect(dialogText()).toContain("the 1 page above them");
    expect(dialogText()).not.toContain("the 2 pages above them");
  });

  it("a top-level page still warns about the whole-knowledge-base scope, with no page count above it", async () => {
    // The extreme case from the migration's header: the root scope has no
    // scope_page_id at all, so NO page delete at any depth can reach it
    // through the schema. A dialog that only mentioned ancestors when there
    // were some would go silent on exactly the row that is always affected.
    await render({ page: PAGES.find((p) => p.id === "unrelated") });
    const text = dialogText();
    expect(text).toContain("your whole knowledge base");
    expect(text).not.toMatch(/pages? above/);
  });

  it("uses singular wording for a single page and plural for several", async () => {
    await render({ page: PAGES.find((p) => p.id === "unrelated") });
    expect(dialogText()).toContain("this page");
    expect(dialogText()).not.toContain("those 1 pages");

    await render({ page: PAGES.find((p) => p.id === "ledger") });
    expect(dialogText()).toContain("those 3 pages");
  });

  it("never hides the clause behind a truthiness check on a count that can legitimately be zero", async () => {
    // A leaf page at the top level has zero sub-pages and zero ancestors, and
    // is exactly the shape an `if (descendantCount > 0)` guard would silence.
    await render({ page: PAGES.find((p) => p.id === "unrelated") });
    expect(dialogText()).toMatch(/question history/i);
  });

  it("does not promise anything the delete path does not actually do - no attachment or page-body claim", async () => {
    await render({ page: PAGES.find((p) => p.id === "ledger") });
    expect(dialogText()).not.toMatch(/attachment/i);
  });
});
