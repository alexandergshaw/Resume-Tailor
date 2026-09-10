### R-188 | area: experience-api | parallel-safe: yes | automatable: yes

**Summary:** The knowledge base routes take ownership from the session only, and tell a caller nothing about rows that are not theirs.

**Steps:**
1. From `hello-world`, run `npx vitest run app/api/experience/routes.contract.test.js`.

**Expected:** 11 tests pass, covering:

- Every route answers 401 without a session AND never calls the data layer at all. Paired with a positive control, so a route that 401s unconditionally fails.
- `user_id` always comes from the session. A `user_id` in the request body is ignored and must not appear anywhere in the arguments passed to the data layer.
- A `parent_id` the caller does not own returns **404, not 403** - 403 would confirm the row exists to someone who cannot see it. Paired with a positive control on a parent the caller does own.
- `POST /api/experience/move` refuses a body that omits the `newParentId` KEY, rather than treating the omission as "move to top level". The tree layer treats `undefined` as `null` deliberately; the route must not let a caller reach that by dropping a key.
- A move the tree rejects comes back as 400 carrying the machine `reason` code, and never reaches the store.

