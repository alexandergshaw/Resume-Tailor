// N60 S4 (AC-E2) -- the outbound alert-mail ceilings, named in one place so
// alertMailLedger.js's reserve call and any confirmation copy can never
// quietly drift apart. Zero imports, pure constants -- client-safe, so a
// "use client" component may import these for its own copy without dragging
// server code into the bundle.

// Per recipient address, per UTC calendar day.
export const MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY = 4;

// Per account, across every address it mails, per UTC calendar day.
export const MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY = 10;
