# IRKOP CELL — GLOBAL AGENT RULES

## Identity

Project: Irkop Cell
Planning baseline: PRD Revisi 6.2 Final
Timezone: Asia/Jakarta

## Source of Truth

Use these files as the project authority:

1. `PRD_Revisi_6.2_Final.md`
2. `schema_d1_revisi6.2.sql`
3. `TEAM_DIVISION_IRKOP_CELL.md`
4. API Contract yang sudah disepakati/di-commit

Priority:

PRD → Schema/API Contract → Implementation

Do not silently replace a locked project decision with personal assumptions.

## Universal Rules

- Do not invent requirements.
- Do not change business rules without an explicit decision.
- Do not modify database schema casually.
- Do not create a parallel schema when the official schema already exists.
- Use Asia/Jakarta for application-facing date/time behavior according to the PRD.
- Financial balance changes must follow the official financial flow.
- `mutasi_saldo` is the financial source of truth.
- Closing must not create a second financial deduction.
- Financial correction must preserve traceability through the approved reversal/adjustment mechanism.
- Financial records must not be hard-deleted if the PRD requires soft-delete/reversal.
- Do not expose secrets or API keys in frontend code, logs, screenshots, or commits.
- Do not claim a feature is complete without testing the relevant acceptance criteria.

## Scope Rule

Only work inside the assigned Team scope.

If a task requires another team's work:

1. Do not implement that team's responsibility yourself.
2. Identify the dependency.
3. Mark the task `BLOCKED` or `WAITING_DEPENDENCY`.
4. Provide a concrete handoff request.

## Ambiguity Rule

If the requirement is already defined in the PRD, follow it.

If it is not defined:

```text
STATUS: BLOCKED
REASON: Requirement not defined
QUESTION: <one concrete question>
IMPACT: <what cannot safely be implemented>
```

Do not silently invent business behavior.

## Task ID

Use:

`IRKOP-T<TEAM>-<NUMBER>`

Examples:

- `IRKOP-T1-001`
- `IRKOP-T2-001`
- `IRKOP-T3-001`

## Required Final Report

Every completed task must report:

- Task ID
- Status
- Files created
- Files modified
- What was implemented
- API/database impact
- Tests performed
- Test result
- Known limitations
- Dependencies for other teams
- Next recommended task

Allowed statuses:

`TODO`, `IN_PROGRESS`, `BLOCKED`, `WAITING_DEPENDENCY`, `READY_FOR_REVIEW`, `DONE`, `REJECTED`

## Never Do

- Do not rewrite the PRD from memory.
- Do not change financial rules because they seem easier.
- Do not make frontend the source of truth for balances.
- Do not create fake API responses and present them as production contracts.
- Do not mark tests as passed without actually running them.
