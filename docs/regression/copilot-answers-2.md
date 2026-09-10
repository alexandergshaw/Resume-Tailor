### R-363 | area: copilot-answers | parallel-safe: yes | automatable: partly

**Summary:** Two disclosures now live inside one `<li>` — the citation reveal and "More detail" — and a screen reader must meet **one** pattern, not two. The citation control's accessible name is its own visible sentence, which a MUI `Tooltip` would silently override. jsdom has no accessibility tree: the ARIA *attributes* are asserted, what a real AT actually says is not.

**Steps:**
1. With a screen reader running, arrow onto a bullet that has both a citation and an expansion control.
2. Activate the citation, then the expansion, then collapse both.
3. Tab through a three-bullet answer where every bullet has a citation.

**Expected:** (i) The bullet is announced as one item: point, then source, then the two controls — the citation is **not** behind a disclosure. (ii) Each control announces collapsed/expanded and its own name, and the citation control's name is the sentence you can see. (iii) No control announces a name that differs from its visible text, and no `aria-controls` points at an element that is not there.

### R-364 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** The reveal costs nothing at request time and nothing at hover time. It rides the citation the answer already returns, so it survives a cache hit and issues **no request of its own** — deliberately, because this app has no rate limiting under `app/api` and a new per-hover endpoint would be unbounded by construction.

**Steps:**
1. With the network tab open, draft an answer and hover, focus and open every citation on it several times.
2. Ask the same question again so it is served from the answer cache, and open its citations.
3. Reveal, hide and re-reveal a practice-mode sample answer, then open its citations.

**Expected:** (i) **Zero** network requests from any citation interaction. (ii) The cached answer's citations still carry their sections and their reveals — a cache write that dropped the enrichment shows a citation that silently loses its blurb on the second ask, which is the failure `pageSources` itself already had once. (iii) Practice mode behaves identically to live mode; neither surface needed a new prop.

### R-365 | area: copilot-answers | parallel-safe: yes | automatable: no

**Summary:** The marked term does not disturb the line box. This is the whole reason the inline control is a bare `<button>` with `display: inline` and no padding rather than a MUI one, and it is the single measurement jsdom cannot make: `getBoundingClientRect()` returns zeroes and there are no font metrics, so nothing in the test suite can see a bullet that grew a line, a word that stopped wrapping, or a gap where a multiword term crossed a line break. The declared CSS is asserted; the rendering is not, and is not claimed to be.

**Steps:**
1. Open a posting whose glossary has landed, draft an answer, and read a bullet containing a marked multiword term (e.g. "payments platform") at a desktop width.
2. Narrow the window until that term falls across a line break.
3. At 320px and again at 375px, read a bullet with two marked terms, one of them inside the bolded run.
4. Select the whole bullet with the mouse and copy it.

**Expected:** (i) The bullet occupies exactly the lines it did before the glossary landed; no term pushes a gap, and the dotted underline sits under the word rather than shifting its baseline. (ii) A multiword term WRAPS across the line break like ordinary text rather than jumping whole to the next line. (iii) Nothing on a phone is clipped or overlapped, and the bolded run still reads as one emphasis rather than as bold-plus-a-control. (iv) The copied text is exactly the sentence, with no extra characters, no marker and no missing words.

### R-366 | area: copilot-answers | parallel-safe: yes | automatable: no

**Summary:** The card is where a reader can actually put it. jsdom has no layout, so Popper's placement, the flip when a bullet sits at the bottom of the answer pane, and whether the card is clipped by that pane's own scroll container are all unmeasurable in tests — and the answer pane IS its own scroll container at `md` and up, which is why the card is portalled rather than in flow.

**Steps:**
1. Hover a marked term on the FIRST bullet of an answer, then on the LAST bullet, with the answer pane scrolled to its bottom.
2. Repeat at 320px with the longest definition in the row.
3. Open a card, then scroll the answer pane behind it.
4. Rotate a phone to landscape with a card open.

**Expected:** (i) The card appears next to the word, fully visible, not clipped by the pane's edge and not off-screen; on the last bullet it flips above the word rather than being cut off. (ii) At 320px it fits the viewport, wraps rather than overflowing horizontally, and the definition scrolls inside its own box. (iii) The page and the pane still scroll and the answer behind the card is still readable — nothing is focus-trapped and nothing is inert. (iv) Rotation does not leave the card stranded over the first bullet.

### R-367 | area: copilot-answers | parallel-safe: yes | automatable: partly

**Summary:** Hover, focus and tap all reach the definition, and WCAG 1.4.13's three obligations hold in a real browser. The timings are pinned by tests (120ms to open on hover, 200ms of grace to travel onto the card, no auto-dismiss at all); whether they FEEL right to a hand moving across a phone is not, and is what this case is for. Hover does not exist on touch, where a spurious `mouseleave` arrives right after the tap — which is why activation latches.

**Steps:**
1. Mouse: sweep the pointer quickly across a bullet with three marked terms without stopping. Then rest on one, move the pointer ONTO the card, and read it. Then move away entirely.
2. Keyboard: with the mouse unplugged, Tab to a term, then Tab again into the card and onto the source link, then Shift+Tab back out, then press Escape.
3. Touch: tap a term, scroll the page, tap the same term, tap a different term, tap outside.
4. Open a card and leave it for a full minute without touching anything.

**Expected:** (i) The sweep opens NOTHING — no cascade of cards. Resting opens one; it survives the pointer travelling onto it; it closes shortly after the pointer leaves both. (ii) Focus alone opens it; the source link is reachable by Tab and the card does not close on the way there; Escape closes it and focus is STILL ON THE TERM, not moved. (iii) A tap opens it and it STAYS open; a second tap on the same term closes it; a tap on a different term leaves exactly one card open; a tap outside closes it. (iv) After sixty seconds it is still open — nothing closes on a timer.

### R-368 | area: copilot-answers | parallel-safe: yes | automatable: no

**Summary:** A sourced term and an unsourced one are distinguishable when the colour is gone. About half the terms on a finished posting carry no source at all — that is the design's resting state, not a failure — so the unsourced card is the ordinary case and must read like one. The distinction is carried by a SENTENCE ("This is a general definition. It has no source.") rather than by a missing link, because absence of a link is not a signal a reader can perceive: they cannot know a link was possible.

**Steps:**
1. On a posting whose panel says "N of M terms have a source", open one card of each kind side by side.
2. Print the screen, or view it, in greyscale.
3. With a screen reader running, move onto a marked term and listen to the whole card.
4. Read the marked term itself in greyscale, in a bullet, without opening anything.

**Expected:** (i) One card names a host and offers "Source: {host}"; the other carries the sentence saying it has none. The two differ in WORDS. (ii) Both remain distinguishable with no colour at all. (iii) The screen reader announces the term, then the provenance line, then the quote, then the definition, then the source line — provenance BEFORE definition — and the term's own accessible name is exactly the word on screen, with no definition read out on focus. (iv) The marked term is identifiable in greyscale by its dotted underline, and does not read as a link.

### R-369 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** The card never puts a redirector, a shortener or an interstitial in front of a reader, and it never names a publisher it does not link to. `position_glossaries` has no `user_id` and every authenticated account can read every row, so `source_url` is model-influenced text written by somebody else's browser. It is re-validated at RENDER — the href gate, the vendor-redirect rule and the third-party-intermediary rule — not only at ingest, so a row written by an older or weaker ingest cannot reach a reader.

**Steps:**
1. Hand-write a row whose `source_url` is a `grounding-api-redirect` URL, one that is a `t.co` link, and one that is `https://www.google.com/url?q=...`; open each term's card.
2. Hand-write a row whose `source_url` is `javascript:alert(1)`, and one whose `source_host` says `acme-recruiting.example` while its `source_url` is `https://www.postgresql.org/...`.
3. Open a card for a term sourced to each of `en.wikipedia.org`, `www.postgresql.org`, `learn.microsoft.com` and `datatracker.ietf.org`.
4. Click a real source link.

**Expected:** (i) Each of the three hostile URLs renders ZERO links AND the unsourced wording, first line included — the card must not say "In this posting · postgresql.org" and then decline to link it. (ii) The `javascript:` row renders no anchor at all (not `href=""`, not `href="#"`) and still shows its definition; the drifted `source_host` is nowhere on the card, which shows `postgresql.org`. (iii) All four real publishers ARE linked — without this the rule passes by refusing everything. (iv) The link opens in a NEW tab, the copilot is not navigated away from, and the session is not lost.

### R-370 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** The glossary does not move the bold. Four features now share one `<li>`: the emphasis span, the expandable sub-bullets, the citation reveal, and the marked terms. The emphasis rule is that exactly one `<strong>` covers exactly `point.slice(start, end)`, and the marks are computed once over the whole point and then partitioned by that boundary — a mark crossing either edge is dropped whole rather than split. Measured over the repository's own answer corpus the drop costs nothing (0 of 882 candidate marks), while 218 of them land INSIDE the bolded run, so both halves of the rule are live.

**Steps:**
1. On a posting with a landed glossary, draft answers to six different questions and read every bullet.
2. Find a bullet whose bolded run contains a marked term, and one where a term sits on either side of the bold.
3. Expand a bullet's sub-bullets and open its citation while a card is open.
4. Compare a bullet before the glossary lands (immediately after applying) with the same bullet after.

**Expected:** (i) Every bullet has exactly one bold run and it covers exactly the same words it covered before the glossary existed. (ii) A term inside the bold is underlined AND bold, and no term is ever half-underlined across the bold's edge. (iii) The sub-bullets carry no marks of their own, the citation sentence carries none, and the three controls do not interfere. (iv) The bullet's TEXT is byte-identical before and after — read one aloud from each and nothing has moved.

### R-371 | area: copilot-answers | parallel-safe: yes | automatable: yes

**Summary:** A hover costs nothing and discloses nothing. The whole glossary is read ONCE when the posting is selected and held in memory, so a hover is a lookup. That is not only a performance point: a per-hover request, a publisher favicon or a `preconnect` would each tell a third party what a candidate is looking up, mid-interview, before they clicked anything. A row still being researched is deliberately NOT polled.

**Steps:**
1. With the network tab open, select a posting, draft five answers and open ten cards.
2. Leave the page open for five minutes on a posting whose panel says sources are still being added.
3. Reload the page.
4. Watch the network tab while hovering a term whose source is a real publisher.

**Expected:** (i) Exactly ONE request to `/api/copilot/glossary`, and zero further requests from any hover, focus or tap. (ii) No polling — the request count does not grow over five minutes, and the panel line does not move. (iii) The reload picks up whatever the worker has finished by then. (iv) No favicon, no preconnect, no prefetch and no request to the publisher's host until the reader actually clicks the link.

### R-372 | area: copilot-answers | parallel-safe: yes | automatable: partly

**Summary:** The state is visible in exactly one place, and no button is offered that cannot act. The bullets never change while a glossary is absent, incomplete or failed — no spinner, no placeholder underline, no "researching…" caption — because a bullet that changes shape under the reader's eyes mid-interview is worse than a bullet with no marks. So the state lives in the "Terms for this posting" panel: one plain-text line per state, sixteen of them, never an icon and never a colour. Three of the sixteen exist so that a rebuild limit, a cooldown and a stalled worker are not invisible.

**Steps:**
1. Apply to a posting and watch the panel from the moment of applying through to completion.
2. Press Rebuild, then press it again within the hour.
3. Exhaust a posting's rebuild budget.
4. Deploy with the cron worker disabled and open a posting applied to more than thirty minutes ago.
5. Open a posting on a keyless (embedded) deployment.

**Expected:** (i) The line moves from "not been collected yet" to "M terms are ready. Sources are still being added — N of M so far." to the resting "N of M terms have a source. The other K are general definitions with no source — they are labelled." The BULLETS do not change shape at any point. (ii) The second Rebuild inside the hour shows the cooldown line naming the time, and NO button. (iii) At the budget, the rebuild-limit line, and NO button. (iv) The stalled-worker line says something is wrong on our side — this is the line that turns a deployment mistake into a visible fact. (v) The embedded line says the engine quotes the posting instead of looking terms up, and says how to escape it; every card on that posting shows a posting quote, no definition and no link.

