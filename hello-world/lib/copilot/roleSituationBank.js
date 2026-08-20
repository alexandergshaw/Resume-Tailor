// Deterministic situation bank behind the /copilot "Speak as" drill
// (AC-Q2). Each situation is a SCENE, not a topic: it names who is in the
// room and what they just said or asked, so the user can answer it out
// loud as the role would. This is the no-network fallback nextRoleSituation
// (lib/copilot/roleSituations.js) always has available, and it is what
// roleResponseLocal (lib/copilot/roleResponse.js) drafts its model answer
// from when a situation came from here rather than from Gemini.
//
// Every situation's `beats` are the SUBSTANCE a strong answer is built
// from - the actual content, not an instruction to the user - and they are
// required (by the contract test, joining this file against
// roleRegisters.js) to use at least two of that role's own `vocabulary`
// terms verbatim. That join is what makes the drill teach a role's
// register instead of merely describing it: a manager's situations use a
// manager's terms, a clinician's use a clinician's, and the two must not
// read as interchangeable with the nouns swapped.
//
// Deliberately data plus pure functions only: no React, no DOM, no
// network, no randomness, no wall-clock reads.

import { ROLE_VALUES, normalizeRole } from "./roleRegisters.js";

export const ROLE_SITUATIONS = {
  manager: [
    {
      id: "manager-missed-deadline",
      prompt:
        "Your VP corners you before the all-hands and asks, in front of two other directors, why the " +
        "integration project is now two weeks behind the date you promised them last month.",
      context: "The VP already promised that date to a customer, so the delay lands on their credibility too.",
      beats: [
        "The two-week slip traces to a vendor API that changed its auth flow without notice, not to the team's pace or effort.",
        "This delay is on me for underestimating integration risk when I set the original date, not on any one engineer.",
        "The plan is to escalate the vendor blocker today and re-baseline the schedule with one added action item due Friday.",
        "We will check in at Thursday's 1:1 and I will loop in every stakeholder on the new date by end of week.",
      ],
    },
    {
      id: "manager-peer-blocker-pushback",
      prompt:
        "A peer manager on another team stops you in the hallway and says your team's constant blockers are " +
        "why his own roadmap keeps slipping, and he wants to know what you're going to do about it.",
      context: "His team depends on an API your team owns, and he already raised this once in a joint planning meeting.",
      beats: [
        "The dependency his team is waiting on is a real blocker on our side, tied to a headcount gap we have not backfilled yet.",
        "This is my call to make, and I own the timeline commitment I gave his team, not just my own team's excuses.",
        "The plan is to escalate the open requisition today and set one action item: a temporary fix shipped by Friday.",
        "We will check progress at next week's 1:1 and I will tell him directly if the date moves again.",
      ],
    },
    {
      id: "manager-promotion-decision",
      prompt:
        "Two of your engineers want the same senior role you can only fill once this quarter, and both are " +
        "standing in your office right now asking which one of them you are going to promote.",
      context: "Promoting the wrong one risks losing the other to a competitor within the month, and both already know that.",
      beats: [
        "The headcount only supports one promotion this quarter, and stretching it to two would break the comp structure for the team.",
        "This decision is mine to make and mine to own publicly, not something I will let the two of them fight out.",
        "The plan is one clear action item: a documented rationale shared with both of them by end of day, not a vague explanation.",
        "I will set a 1:1 with the person not promoted this week to talk about their own path forward from here.",
      ],
    },
    {
      id: "manager-new-hire-question",
      prompt:
        "A new hire barely three weeks in raises their hand in your team meeting and asks, in front of everyone, " +
        "why the project plan changed twice already and whether that means the team is disorganized.",
      context: "Two senior engineers are also in the room, and how you answer sets the tone for how the new hire trusts future plans.",
      beats: [
        "Here's what actually happened: this was scope creep from a client add-on, not the team losing focus.",
        "I'll own this one myself - I approved that first change without pushing back hard enough, and that's on me.",
        "The plan going forward is one action item: any new request gets logged and reviewed before it changes the roadmap.",
        "I will check in at our next 1:1 to see how the changes landed for you specifically, not just for the group.",
      ],
    },
    {
      id: "manager-skiplevel-trust-check",
      prompt:
        "Your skip-level director pulls you aside after your update and asks pointedly whether you actually " +
        "trust the two engineers you just said were struggling, or whether the real problem is how you're managing them.",
      context: "The director has already heard a different version of this story from someone else on the team.",
      beats: [
        "The facts are that both engineers are stuck behind a shared blocker, not underperforming on their own work.",
        "I own how I framed it in the update - too vague - not the engineers' actual performance.",
        "The plan is to escalate the shared blocker today and set an action item with a fix date attached.",
        "I will bring both engineers into next week's 1:1 rotation to make sure they feel supported, not surveilled.",
      ],
    },
  ],
  executive: [
    {
      id: "executive-guidance-cut",
      prompt:
        "The board chair opens the quarterly call by asking you directly why revenue guidance is being cut " +
        "for the second time this year, before you have even gotten through your prepared remarks.",
      context: "Two board members have already signaled they are losing patience with repeated guidance misses this year.",
      beats: [
        "The number is a twelve percent cut to this quarter's guidance, and I am leading with that before anything else.",
        "The driver is a churn spike in one enterprise segment, a real headwind, not a broad demand problem across the business.",
        "The ask is board patience for one more quarter while we fix the specific segment causing it, not a strategy reset.",
        "We will report the corrected number and the P&L impact at next month's board update, on a fixed date.",
      ],
    },
    {
      id: "executive-budget-pushback",
      prompt:
        "Your co-founder, who runs sales, tells you flatly in the leadership meeting that cutting the marketing " +
        "budget you are proposing will blow up his pipeline and he is not going to support it.",
      context: "The board meets in two weeks and expects one unified capital plan from leadership, not a public disagreement.",
      beats: [
        "The number is a fifteen percent cut to marketing spend, aimed at extending runway by four months.",
        "The driver is capital allocation discipline heading into a leaner year, not a vote against sales.",
        "The ask is that we model both scenarios against the same north star metric before either of us commits to a number.",
        "We will bring one shared recommendation to the board next week, not two competing plans.",
      ],
    },
    {
      id: "executive-product-line-call",
      prompt:
        "You are standing in front of the entire company at the all-hands, and you have to announce, right now, " +
        "whether the company is shutting down the unprofitable product line before the next funding round closes.",
      context: "Thirty people work on that product line and have not been told anything yet.",
      beats: [
        "The number is this: the product line burns two point eight million dollars a quarter against four percent of total revenue, and yes, we are shutting it down.",
        "The driver is a capital allocation decision, not a judgment on the team who built it.",
        "The ask is thirty days of transition time for the people on that team before anything changes for them.",
        "We will set the OKRs for the wind-down explicitly, so this becomes a managed transition, not a scramble.",
      ],
    },
    {
      id: "executive-analyst-question",
      prompt:
        "A first-year analyst raises their hand at the town hall, right in front of you, and asks whether last " +
        "quarter's layoffs mean the business is actually failing.",
      context: "This is the analyst's first town hall, and the room has gone quiet waiting for your answer.",
      beats: [
        "The number is eleven months of runway, with unit economics improving quarter over quarter, not a business in freefall.",
        "The driver behind last quarter's cuts was a deliberate capital allocation choice to reach profitability sooner, not failure.",
        "The ask is trust in the plan we are about to walk through, not just trust in a headline number.",
        "We will publish the OKRs for this quarter to the whole company so everyone can see the plan directly.",
      ],
    },
    {
      id: "executive-investor-check",
      prompt:
        "A lead investor calls you directly, ahead of the scheduled board meeting, and asks whether the P&L you " +
        "sent last week actually reflects a real slowdown or just seasonal noise.",
      context: "This investor sits on two other boards and compares notes with them regularly.",
      beats: [
        "The number is a real four percent sequential slowdown in the P&L, not seasonal noise.",
        "The driver is a specific headwind in one region's enterprise renewals, not a company-wide trend.",
        "The ask is confidence to hold the current guidance for one more quarter while we confirm the pattern.",
        "We will bring the full board the regional breakdown at the scheduled meeting, with no surprises before then.",
      ],
    },
  ],
  professor: [
    {
      id: "professor-grading-complaint",
      prompt:
        "Your department chair calls you into her office and tells you two students have formally complained " +
        "that your grading on the midterm was inconsistent across sections, and she wants your explanation today.",
      context: "Both students are pre-med and a grade change could affect their program applications this cycle.",
      beats: [
        "The standard applied was the same rubric distributed with the syllabus in week one, and both sections were graded against those identical criteria.",
        "The reasoning for the score gap is that one section's exam covered a topic taught a day later than planned, not that the rubric was applied differently.",
        "The path forward is one supplemental question for just the affected section, scored against that same rubric, so no one is penalized for a scheduling gap.",
        "I will hold extra office hours before the next exam specifically to walk through how the rubric is applied.",
      ],
    },
    {
      id: "professor-curriculum-pushback",
      prompt:
        "A colleague on the curriculum committee tells you flatly that your proposed course redesign ignores " +
        "the department's own literature review requirement and that he is going to vote against it as written.",
      context: "The committee vote is scheduled for next week and needs a majority to pass.",
      beats: [
        "The standard I'm applying is the same academic integrity and rigor bar the department already uses for capstone courses.",
        "The reasoning is that a literature review is still required, just moved to week four instead of week one, not removed.",
        "The path forward is a revised syllabus that makes the literature review requirement explicit again before the vote.",
        "I will bring the revised syllabus to his office hours this week so he can review the actual language himself.",
      ],
    },
    {
      id: "professor-integrity-call",
      prompt:
        "You are sitting across from a student in your office, and you have to decide, right now, whether the " +
        "unattributed paragraph in their thesis draft is a citation mistake or an academic integrity violation for the committee.",
      context: "This student is three weeks from their defense and has never had a prior issue.",
      beats: [
        "The standard is the same academic integrity policy stated in the syllabus, and it requires this go through the formal review process, not a private read of my own.",
        "The reasoning I'll walk you through is that an unattributed paragraph like this is exactly the kind of case our policy requires I refer, whatever I personally believe about intent.",
        "The path forward is I file the referral today, and the review process is where you get a real chance to explain what happened before anything is decided.",
        "I will set a follow-up meeting during office hours next week to walk through proper citation practice together, regardless of how the review turns out.",
      ],
    },
    {
      id: "professor-student-question",
      prompt:
        "A first-year student stays after class and asks you, a little embarrassed, why their paper only got " +
        "full credit on the rubric for structure and lost points everywhere else when they thought it was strong.",
      context: "This is the student's first college-level paper and their first ever piece of critical feedback.",
      beats: [
        "The standard applied is the same rubric every paper in the class is graded against, not a personal read of the writing.",
        "The reasoning is that the argument needed more evidence from the assigned literature review sources, not that the writing itself was weak.",
        "The path forward is a revision on the evidence section only, using the same rubric criteria already shared.",
        "I will hold office hours specifically this week to go through how to strengthen the evidence section together.",
      ],
    },
    {
      id: "professor-tenure-question",
      prompt:
        "A senior colleague on your tenure committee asks you directly, in the hallway before the vote, why " +
        "so few of your last two years' papers have actually cleared peer review and been published.",
      context: "The tenure vote is in three weeks and this colleague's opinion carries real weight with the rest of the committee.",
      beats: [
        "The standard I hold my own work to is the same peer review bar the department expects of anyone up for tenure.",
        "The reasoning is that two of those papers are still in active peer review right now, not that I skipped the process.",
        "The path forward is sharing the current peer review status of each paper with the committee before the vote.",
        "I will send the reviewer correspondence for both papers to the committee chair this week.",
      ],
    },
  ],
  clinician: [
    {
      id: "clinician-family-update",
      prompt:
        "A patient's adult daughter stops you in the hallway outside the room and asks, before you have even " +
        "finished reviewing the latest labs, whether her father's condition means he is dying.",
      context: "The family has already been given conflicting updates by two different providers this week.",
      beats: [
        "The assessment right now is that his chief complaint of shortness of breath is being worked up, with imaging still pending.",
        "The risk is real but not yet fully defined until the differential diagnosis narrows, and I will not guess ahead of the data.",
        "The plan is to complete the imaging today and reassess this evening with the full team.",
        "I will confirm with you and your father together once the results are in, so no one hears it secondhand again.",
      ],
    },
    {
      id: "clinician-handoff-pushback",
      prompt:
        "The night-shift physician taking handoff tells you bluntly that your assessment of the patient in bed " +
        "four is wrong and that she is going to reorder the workup from scratch.",
      context: "Bed four's patient has been in the emergency department for six hours already.",
      beats: [
        "The assessment reflects the chief complaint as stated at intake, chest pain with no cardiac risk factors on the initial screen.",
        "The risk I flagged is low but not zero, which is exactly why the differential diagnosis still includes two other causes.",
        "The plan I would recommend is finishing the current workup before restarting it, to avoid duplicating tests unnecessarily.",
        "I will walk you through the full handoff notes now so nothing gets lost between us.",
      ],
    },
    {
      id: "clinician-triage-call",
      prompt:
        "You are standing at the triage desk with three patients waiting, and you have to decide right now " +
        "which one gets the one open bed, knowing two of the family members are watching you make that call.",
      context: "One of the three patients arrived by ambulance and the other two walked in together.",
      beats: [
        "The assessment from triage puts the ambulance arrival at the highest acuity, based on vital signs, not order of arrival.",
        "The risk of delaying the ambulance patient's care is real: deprioritizing the highest-acuity case here would fall below the standard of care owed to them.",
        "The plan is the ambulance patient takes the open bed now, and the other two are reassessed every fifteen minutes.",
        "I will explain this decision to both waiting families directly, since a triage call made silently reads as favoritism.",
      ],
    },
    {
      id: "clinician-student-question",
      prompt:
        "A third-year medical student shadowing you today asks, right in front of the patient, why you did " +
        "not just order every test up front instead of waiting on the differential diagnosis to narrow first.",
      context: "The patient is listening closely and looks a little unsettled by the question.",
      beats: [
        "The assessment right now rests on a chief complaint of abdominal pain with a differential diagnosis that still includes three possibilities.",
        "The risk of ordering every test at once is unnecessary radiation and cost for possibilities we can rule out with one exam first.",
        "The plan is one targeted test now, chosen because it best narrows the differential diagnosis at the lowest risk to the patient.",
        "I will confirm the patient understands the plan before we walk out, and then answer your question in more detail after.",
      ],
    },
    {
      id: "clinician-consent-question",
      prompt:
        "The attending physician pulls you aside after rounds and asks pointedly whether the patient actually " +
        "understood the risks before you had them sign the consent form for the procedure this morning.",
      context: "The patient's family later told a nurse they felt rushed through the paperwork.",
      beats: [
        "The assessment is that informed consent was obtained, but I want to revisit it because the family's account raises a real concern.",
        "The risk is that a rushed, unclear conversation like that can fall below the standard of care for informed consent, whatever the outcome turns out to be.",
        "The plan is to sit down with the patient again before the procedure and walk through the risks at an unhurried pace.",
        "I will confirm understanding out loud this time and document it clearly, rather than assuming the signature alone was enough.",
      ],
    },
  ],
  attorney: [
    {
      id: "attorney-settlement-demand",
      prompt:
        "Your client calls you in a panic and says opposing counsel just sent over a settlement demand three " +
        "times higher than either of you expected, and she wants to know right now if you can still win at trial.",
      context: "The client has already told her business partners she expects this to settle cheaply.",
      beats: [
        "My position is yes, we can still win at trial - this demand is a negotiating number, not a read on how a jury would see the facts we actually have.",
        "The basis for that is the discovery record so far, which still favors our version of the facts on the key dates.",
        "The exposure worth flagging is the statute of limitations on the counterclaim, which closes in six weeks regardless of settlement talks.",
        "The recommendation is we counter at a specific number this week and keep it off the record until it is final.",
      ],
    },
    {
      id: "attorney-discovery-pushback",
      prompt:
        "Opposing counsel calls you directly and tells you flatly that your client's latest document " +
        "production is incomplete and threatens to file a motion to compel by Friday if nothing changes.",
      context: "Your firm's own paralegal flagged the same gap in the production two days ago.",
      beats: [
        "My position is I'm not going to tell you the production is complete until I've re-verified it myself, given the gap already flagged internally.",
        "The basis is our discovery obligations were defined by the agreed search terms, which I will personally re-verify against what actually went out.",
        "The exposure worth flagging is that an incomplete production risks a motion to compel and real liability for the client, not just an inconvenience.",
        "The recommendation is I confirm the production myself today and call her back before any motion gets filed.",
      ],
    },
    {
      id: "attorney-privilege-call",
      prompt:
        "You are on a call with your client right now, and you have to decide, on the spot, whether to hand " +
        "opposing counsel an internal memo they are demanding or assert privilege over it and risk the judge's irritation.",
      context: "The memo was written by the client's own general counsel, not by your firm.",
      beats: [
        "My position is we assert privilege over the memo, because it was prepared for legal advice, not for business purposes.",
        "The basis is the memo was authored by in-house counsel to assess legal liability on this matter, not ordinary business planning.",
        "The exposure worth flagging is a possible waiver if we produce even part of it voluntarily right now.",
        "The recommendation is we log it on the privilege log and let the judge rule on it, rather than hand it over ourselves.",
      ],
    },
    {
      id: "attorney-associate-question",
      prompt:
        "A first-year associate on your case knocks on your door and asks, a little nervous, why you told the " +
        "client the discovery deadline matters more than winning the argument in the meeting they just left.",
      context: "This associate drafted the memo for that meeting and is worried they got the emphasis wrong.",
      beats: [
        "My position is the discovery deadline matters because missing it can end the case regardless of who has the better argument.",
        "The basis is the burden of proof only matters if we actually get to present it, and a missed deadline can foreclose that.",
        "The exposure worth flagging is malpractice risk if a deadline like that gets missed on our watch, not just a bad outcome for the client.",
        "The recommendation is you build a deadline tracker into every memo going forward, starting with this case.",
      ],
    },
    {
      id: "attorney-retainer-question",
      prompt:
        "A senior partner stops you in the hallway and asks bluntly why this client's retainer has not been " +
        "replenished in two months while your billable hours on the matter keep climbing.",
      context: "This client is also a personal friend of the partner asking the question.",
      beats: [
        "My position is the retainer lapsed because I have been heads-down on litigation deadlines, not because I am avoiding the conversation.",
        "The basis is that same crunch meant the last two invoice cycles went out late, so the retainer never got the trigger it needed to replenish.",
        "The exposure worth flagging is that letting a friendship delay the retainer conversation any further looks like preferential treatment, not sound firm practice.",
        "The recommendation is I send the updated invoice and replenish request today, kept separate from any personal relationship, since sloppy billing creates its own liability.",
      ],
    },
  ],
  consultant: [
    {
      id: "consultant-savings-miss",
      prompt:
        "The client's VP sponsor pulls you into her office before the steering committee meeting and asks " +
        "point blank whether the cost-savings number your team promised at the start of the engagement is still realistic.",
      context: "She has already told her own CEO the original number in a separate meeting last week.",
      beats: [
        "The finding is the achievable savings number is now sixty percent of the original estimate, based on updated procurement data.",
        "The evidence is a hypothesis-driven analysis of three cost drivers, tested against six weeks of actual spend from this engagement.",
        "The recommendation is we present the revised number today rather than let it surface unexpectedly at the steering committee.",
        "The next step is a one-page so-what memo you can bring to your CEO before the meeting, with our team's help.",
      ],
    },
    {
      id: "consultant-workstream-pushback",
      prompt:
        "A fellow engagement manager on your team tells you flatly, in front of the rest of the team, that " +
        "your workstream's findings contradict his and that one of you has to be wrong before Friday's client readout.",
      context: "Both workstreams draw on the same underlying client data set.",
      beats: [
        "The finding in my workstream holds up against the raw data, but I want to reconcile it against his numbers before Friday.",
        "The evidence is a MECE breakdown of cost categories that does not currently overlap with how his workstream defined its own categories.",
        "The recommendation is we merge our two analyses into one model tonight rather than present two conflicting stories.",
        "The next step is a joint deliverable, one number, ready before the readout starts.",
      ],
    },
    {
      id: "consultant-scope-call",
      prompt:
        "You are sitting alone in the client's conference room five minutes before the readout starts, and " +
        "you have to decide right now whether to include the uncomfortable finding about their own team's execution gap in today's deck.",
      context: "The client's head of operations personally requested this engagement and is presenting alongside you today.",
      beats: [
        "The finding is a real execution gap, and cutting it from the deck would mean presenting a recommendation without its full basis.",
        "The evidence for it is hypothesis-driven and specific to two named workstreams, not a general criticism of the team.",
        "The recommendation stands only if we are honest about the finding, so it stays in, framed constructively rather than cut.",
        "The next step is I walk the head of operations through the finding privately before we present it to the wider group.",
      ],
    },
    {
      id: "consultant-analyst-question",
      prompt:
        "A first-year analyst on your team asks, right before the client call, why the recommendation slide " +
        "leads with the answer instead of walking through all the analysis first the way they were taught in school.",
      context: "This is the analyst's first live client call on the engagement.",
      beats: [
        "The finding leads the slide because a client with thirty minutes needs the so-what before the method, not after it.",
        "The evidence is still there, right below the headline, structured MECE so nothing important got left out of it.",
        "The recommendation only works if the client actually reads it, and burying it under analysis risks losing the room.",
        "The next step for you is drafting the next deliverable the same way, answer first, and I will review it before the next call.",
      ],
    },
    {
      id: "consultant-partner-question",
      prompt:
        "The engagement partner calls you an hour before the readout and asks whether you actually have " +
        "stakeholder buy-in from the client's operations team, or whether you are about to present a recommendation they will quietly reject.",
      context: "The partner's own bonus this quarter is tied to this engagement renewing.",
      beats: [
        "The finding has been shared with the operations lead already, and stakeholder buy-in there is real, not assumed.",
        "The evidence for that is two working sessions this month where they helped shape the recommendation themselves.",
        "The recommendation reflects what they already agreed to build, not a surprise we are springing on them today.",
        "The next step is confirming the scope of what they are actually committing to, in writing, before the readout starts.",
      ],
    },
  ],
  "tech-lead": [
    {
      id: "tech-lead-outage-update",
      prompt:
        "Your engineering director messages you at 2am asking exactly how many customers are affected by the " +
        "outage, and whether this is the same single point of failure your team flagged in last quarter's postmortem.",
      context: "Three enterprise customers have already opened support tickets about it.",
      beats: [
        "The impact right now is about eight percent of traffic failing on checkout, concentrated in one region.",
        "The root cause is confirmed as the same single point of failure flagged in last quarter's postmortem that never got prioritized.",
        "The fix is a rollback to the last known-good deploy, already in progress as we speak.",
        "The follow-up commitment is a new postmortem within 48 hours with a hard deadline to actually fix the single point of failure.",
      ],
    },
    {
      id: "tech-lead-blast-radius-pushback",
      prompt:
        "A tech lead on a neighboring team tells you directly in the incident channel that your service's " +
        "on-call engineer ignored his team's warning about the blast radius of this change two days ago.",
      context: "His team's warning was posted in a channel your on-call engineer does not usually monitor.",
      beats: [
        "The impact is contained to our service so far, but he is right that the blast radius could have reached his team's dependency too.",
        "The root cause is a warning that landed in a channel our on-call rotation does not actually watch, not a decision to ignore it.",
        "The fix is a rollback of the change right now, before it reaches anything downstream of us.",
        "The follow-up commitment is adding his team's channel to our on-call alerting so this gap does not repeat.",
      ],
    },
    {
      id: "tech-lead-freeze-call",
      prompt:
        "You are staring at the deploy button five minutes before the freeze starts, and you have to decide " +
        "right now whether to ship the fix as is or hold it, knowing it papers over technical debt instead of actually fixing it.",
      context: "The freeze is for a major product launch happening tomorrow morning.",
      beats: [
        "The impact of holding is the underlying bug stays live through the launch, which is the bigger risk to customers.",
        "The root cause is technical debt in the retry logic that a real fix would take two days to address properly.",
        "The fix going out today is a scoped patch, documented clearly as a stopgap and not a real fix.",
        "The follow-up commitment is a code review and a real fix scheduled for the first week after the freeze lifts.",
      ],
    },
    {
      id: "tech-lead-junior-review-question",
      prompt:
        "A junior engineer on your team asks, a bit sheepishly, during the incident retro why nobody caught " +
        "the bug in code review before it caused an outage affecting real customers.",
      context: "This is the junior engineer's first production incident since joining three months ago.",
      beats: [
        "The impact was real, about ten minutes of failed requests before the rollback finished.",
        "The root cause is that code review caught the logic but missed the specific edge case that only shows up under load.",
        "The fix already shipped is the immediate rollback, and a permanent fix is scheduled for this week.",
        "The follow-up commitment is adding a load test to our code review checklist so this edge case gets caught earlier next time.",
      ],
    },
    {
      id: "tech-lead-director-question",
      prompt:
        "Your director asks you directly in the retro whether the real problem is a single point of failure " +
        "in the architecture, or whether your on-call engineer just missed an alert they should have caught.",
      context: "The on-call engineer involved has been on this rotation for less than a month.",
      beats: [
        "The impact was contained because the on-call engineer escalated within ten minutes of the first alert, within target.",
        "The root cause is architectural, a genuine single point of failure, not a gap in how the on-call engineer responded.",
        "The fix requires redesigning that component so it no longer has a single point of failure, not additional on-call training.",
        "The follow-up commitment is a design review and a postmortem action item tracked to completion, not just a retro note.",
      ],
    },
  ],
  "account-executive": [
    {
      id: "account-executive-pipeline-stall",
      prompt:
        "Your sales manager pulls you into her office and asks flatly why your biggest deal, the one you have " +
        "had in your pipeline for two quarters, just went quiet after procurement started their review.",
      context: "This deal alone is worth a third of your quota for the quarter.",
      beats: [
        "What they are asking is real: the deal has been quiet for eleven days since procurement picked it up, longer than usual.",
        "The value here is that procurement silence at this stage is normal for a deal this size, not a sign it is dead.",
        "The likely objection on their end is budget timing, not product fit, based on my last call with the champion.",
        "The next step is a call with my champion this week to confirm where the deal actually stands - my quota math is mine to run afterward, not something I'll raise with them.",
      ],
    },
    {
      id: "account-executive-territory-pushback",
      prompt:
        "Another account executive on your team messages you directly, upset that you reached out to a " +
        "contact at an account he has been quietly building a relationship with for his own pipeline.",
      context: "Neither of you had formally claimed the account in the CRM yet.",
      beats: [
        "What he is asking is fair: I did not know he was already working this account before I made the call.",
        "The value in sorting this now is one clean pipeline entry instead of two reps confusing the same prospect.",
        "The objection worth taking seriously is that overlapping outreach makes us both look disorganized to the champion at that account.",
        "The next step is we agree today who owns the account and log it properly before either of us calls again.",
      ],
    },
    {
      id: "account-executive-discount-call",
      prompt:
        "You are on a call right now with a prospect who says they will sign today only if you cut the price " +
        "another fifteen percent, and you have to decide on the spot whether to say yes.",
      context: "This deal would meaningfully help you hit quota for the quarter if it closes.",
      beats: [
        "What they are asking is a real discount, not a bluff, based on the budget number they shared on our discovery call.",
        "The value case still holds without the discount, built on the ROI numbers their own champion helped us calculate.",
        "The objection handling here is offering flexible payment terms instead of a price cut that resets renewal expectations.",
        "The next step is I hold the price and send revised terms today, with a decision deadline before end of week.",
      ],
    },
    {
      id: "account-executive-sdr-question",
      prompt:
        "A new SDR who just started shadowing you asks, right after the call ends, why you spent the first " +
        "fifteen minutes just asking questions instead of pitching the product like the training deck said to do.",
      context: "This SDR is building their first-ever discovery call script this week.",
      beats: [
        "What they are asking about is real: I spent that time on a discovery call because pitching before understanding the need wastes time.",
        "The value only lands once I know what they actually care about, which is why I ask before I reframe anything.",
        "Objection handling gets easier later in the call because I already know what pushes their buttons from the discovery call itself.",
        "The next step for you is building your own discovery call script around questions first, pitch second.",
      ],
    },
    {
      id: "account-executive-vp-forecast-question",
      prompt:
        "Your VP of sales asks you directly in the forecast call whether this deal is actually " +
        "MEDDPICC-qualified or whether you are counting soft interest as real ARR again like you did last quarter.",
      context: "Your forecast accuracy last quarter was called out specifically in the board deck.",
      beats: [
        "What she is asking is fair to ask again after last quarter, so I will walk through the qualification honestly.",
        "The value of this deal is real: we have identified the economic buyer and confirmed decision criteria, both MEDDPICC checkpoints.",
        "The one gap is we have not confirmed the paper process yet, so I am not counting the full ARR until procurement signs off.",
        "The next step is a call this week to close that MEDDPICC gap before it goes back into the ARR forecast.",
      ],
    },
  ],
  teacher: [
    {
      id: "teacher-parent-complaint",
      prompt:
        "Your principal calls you into the office and says a parent has complained that their child failed " +
        "the unit test, and wants to know right now whether your classroom management is the real problem.",
      context: "This parent has requested a formal parent-teacher conference for tomorrow morning.",
      beats: [
        "What happened is the student missed three of the five standards-aligned objectives on the test, based on the answer sheet.",
        "The standard applied is the same rubric every student in the class was graded against, shared with families at the start of the unit.",
        "The support I am offering is targeted scaffolding on the two weakest objectives before the retake.",
        "The next step is the parent-teacher conference tomorrow, where we will look at the rubric together.",
      ],
    },
    {
      id: "teacher-iep-pushback",
      prompt:
        "A co-teacher on your grade-level team tells you bluntly in the planning meeting that your lesson " +
        "plans ignore the IEP accommodations for two students in the shared class, and it is starting to show in their work.",
      context: "Both students' IEP reviews are coming up within the month.",
      beats: [
        "What happened is real: this week's lesson skipped the differentiation those two students need, and that is on me to fix.",
        "The standard is the accommodations written into each IEP, which are not optional add-ons to the lesson plan.",
        "The support going forward is scaffolding built into every lesson plan from the start, not added after the fact.",
        "The next step is I revise this week's plans tonight with both IEPs open next to me while I write them.",
      ],
    },
    {
      id: "teacher-refusal-call",
      prompt:
        "You are standing in front of the whole class, and a student has just openly refused to do the " +
        "assignment, and you have to decide right now, in front of everyone, how to respond without losing the room.",
      context: "This is the third time this student has refused an assignment this month.",
      beats: [
        "What happened is a refusal, not defiance for its own sake - this student has struggled with this exact skill all month.",
        "The standard still applies to this student the same as everyone else, so the assignment does not simply go away.",
        "The support is scaffolding down to a smaller version of the same task, done quietly at their desk instead of a public standoff.",
        "The next step is a formative assessment check-in with just this student at the end of class, one on one.",
      ],
    },
    {
      id: "teacher-studentteacher-question",
      prompt:
        "The student teacher you are mentoring asks, right after class, why you gave two different students " +
        "two completely different versions of the same worksheet even though they are learning the same lesson.",
      context: "The student teacher is building their own lesson plans for the first time this week.",
      beats: [
        "What happened is differentiation, not two different lessons - both worksheets cover the same standards-aligned objective.",
        "The standard both students are working toward is identical; only the scaffolding around it changes for each of them.",
        "The support each version offers matches where a quick formative assessment showed each student actually was this week.",
        "The next step for you is trying this with your own next lesson, starting with just one student who needs it.",
      ],
    },
    {
      id: "teacher-principal-question",
      prompt:
        "Your principal asks you directly after a walkthrough why the classroom felt chaotic today, and " +
        "whether your classroom management has slipped since the new student joined two weeks ago.",
      context: "The new student has an IEP that has not been fully implemented yet.",
      beats: [
        "What happened today is real - the room was louder than usual, and it traces to a specific transition, not a general slip.",
        "The standard for classroom management here is the same routine the class has used all year, which the new student has not learned yet.",
        "The support is direct coaching on our routines for the new student, tied to the IEP accommodations already on file.",
        "The next step is a quick classroom management check-in with you next week once the new routines are in place.",
      ],
    },
  ],
  "people-ops": [
    {
      id: "people-ops-termination-request",
      prompt:
        "The VP of Engineering messages you directly and says he wants to fire an employee today without any " +
        "paperwork, because he is done waiting, and asks you to just make it happen this afternoon.",
      context: "This employee filed a reasonable accommodation request two weeks ago that is still open.",
      beats: [
        "Our policy is that we cannot proceed until the open reasonable accommodation request is resolved, regardless of the performance concern.",
        "The rationale is that acting today, with that request still open, is exactly the kind of situation our policy says goes to legal before anything is final.",
        "Our policy requires a documented PIP first if performance is the actual issue, not an immediate termination.",
        "The next step is I will move the accommodation request and the PIP timeline forward in parallel, starting today.",
      ],
    },
    {
      id: "people-ops-exception-pushback",
      prompt:
        "Another HR partner on your team tells you flatly, in front of the rest of the People team, that " +
        "granting a policy exception for one manager's request sets a precedent she is not comfortable with.",
      context: "Three other managers have made similar requests this quarter that were denied.",
      beats: [
        "The policy as written does not allow this request by default, which is exactly why it is being framed as a policy exception.",
        "The rationale for even considering it is a documented compensation band gap unique to this one role, not favoritism.",
        "The process protects consistency by requiring the same policy exception review for anyone in a similar situation going forward.",
        "The next step is I bring the three prior denied requests back to this same review before deciding anything.",
      ],
    },
    {
      id: "people-ops-atwill-call",
      prompt:
        "You are on the phone with a manager who wants to end this employee's job today with no notice - the " +
        "fourth cut from his team this month, with eleven more planned before quarter-end - and you have to decide " +
        "whether that pattern now crosses into WARN Act mass-layoff territory.",
      context: "This site already has thirty-one terminations logged this month; his planned round would push the total to forty-six within thirty days.",
      beats: [
        "At-will employment covers ending any one person's job today, but a cluster of terminations at one site inside thirty days is a different, regulated event.",
        "The rationale for pausing is that this round would push the site to forty-six terminations in thirty days, close to the federal WARN threshold.",
        "The process requires confirming whether the affected roles sit disproportionately in one protected class, then a legal review of the WARN count.",
        "The next step is I loop in legal today with the full site-wide count, before anything is communicated to this employee.",
      ],
    },
    {
      id: "people-ops-coordinator-question",
      prompt:
        "A new HR coordinator on your team asks, a little unsure, why you scheduled a formal exit interview " +
        "for someone who was let go instead of just having them clean out their desk quietly.",
      context: "This is the coordinator's first involuntary termination process since starting last month.",
      beats: [
        "The policy is every departure, voluntary or not, gets an exit interview offer, because the data matters either way.",
        "The rationale is exit interview data feeds directly into what our engagement survey later tells leadership about turnover patterns.",
        "The process protects the company by documenting the departure consistently, not selectively based on how it ended.",
        "The next step for you is sending the exit interview invite today, using the same template for every departure.",
      ],
    },
    {
      id: "people-ops-chro-question",
      prompt:
        "The CHRO asks you directly in the leadership meeting why three people on the same team are being " +
        "paid outside their stated compensation band, and whether that came from you approving exceptions quietly.",
      context: "This same concern came up in last quarter's engagement survey results around pay fairness.",
      beats: [
        "The policy is that all three sit within an approved compensation band range, just at different points based on tenure.",
        "The rationale for the spread is documented performance history, not an informal exception made outside the process.",
        "The process protects fairness because every one of those placements went through the same compensation band review.",
        "The next step is I pull the documentation for all three and share it before the concern grows, given the engagement survey result.",
      ],
    },
  ],
};

// Every situation for a (possibly untrusted) role value, normalized first
// so this never returns an empty list - the register drill always has
// something to show, even for a role value it does not recognize.
export function situationsFor(role) {
  return ROLE_SITUATIONS[normalizeRole(role)];
}

// Defensive: keeps the exported object's keys exactly in step with the
// registry even if a future edit adds a role to one file and not the
// other - callers iterate ROLE_VALUES, not Object.keys(ROLE_SITUATIONS),
// so a missing key would otherwise fail silently instead of loudly.
for (const role of ROLE_VALUES) {
  if (!ROLE_SITUATIONS[role]) {
    throw new Error(`roleSituationBank: no situations declared for role "${role}"`);
  }
}
