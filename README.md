# Hesyra Portal

Dental lab workflow system for **Hesyra Labs**, Nagpur. Dentists submit
prescriptions, the lab designs and manufactures, cases ship back.

Two applications in one repository:

| | |
|---|---|
| **Frontend** | React 19 + Vite 8, CSS Modules — repo root, served on `:5173` |
| **Backend** | Express 5 + Prisma 7 + SQLite — `server/`, served on `:3001` |

---

## Running it locally

Node v24 and npm 11. Two terminals.

**1. Backend**

```bash
cd server && cp .env.example .env && npm install && npx prisma generate && npx prisma db push && node seed.js && node server.js
```

**2. Frontend**, from the repo root:

```bash
npm install && npm run dev
```

Then open <http://localhost:5173>.

`server/.env` is gitignored; `server/.env.example` documents every variable.
The required ones are `DATABASE_URL="file:./dev.db"`, `JWT_SECRET`,
`PORT=3001` and `RAZORPAY_MODE=test`.

### SQLite, not Postgres

`docker-compose.yml` exists and references Postgres, but the Prisma schema's
provider is `sqlite`. **SQLite is the real local path** — the database is a
single file at `server/dev.db` and no Docker is needed. Ignore the compose
file unless you are migrating the datasource.

### Dependency notes

Two pins are load-bearing; changing them breaks the app in ways the build
does not catch.

- **`three` stays at `^0.183.2`.** The committed lockfile once pinned
  `@google/model-viewer@4.2.0`, which needs `three@^0.182`, against
  `three@0.183.2` — an unresolvable tree that failed `npm ci` identically.
  It was fixed by regenerating the lockfile; model-viewer now resolves to
  4.3.1. Do not downgrade `three` to "fix" a peer warning.
- **`react-is` must stay in `package.json`.** It is a peer of `recharts`.
  Without it Vite 500s on the recharts chunk and the app renders a blank
  page with no build error.

---

## Accounts

Every seeded account uses the password **`Hesyra@2026`**. Login accepts
either the email or the username.

| Role | Email | Username |
|---|---|---|
| admin | admin@hesyra.com | `admin` |
| manager | manager@hesyra.com | `mgr_001` |
| technician | tech@hesyra.com | `tech_001` |
| cad_designer | cad@hesyra.com | `cad_001` |
| ceramist | ceramist@hesyra.com | `ceramist_001` |
| clinic | doctor@hesyra.com | `MH272` |
| clinic | doctor2@hesyra.com | `MH273` |
| clinic | newdoc@hesyra.com | `MH274` |

Login is rate-limited in memory, so scripting against the API will trip
"Too many login attempts". Restarting the server clears it.

---

## Scripts

Run from `server/`:

```bash
node seed.js           # full demo seed — accounts and sample cases
node seedCatalog.js    # loads the real published price list into MaterialSKU
node wipe_cases.js     # clears all case data, keeps accounts
npm run db:reset       # force-reset the schema, then reseed
npm run db:studio      # Prisma Studio against dev.db
```

### Tests

```bash
node server/test/pricing.test.js     # or: cd server && npm test
```

49 assertions covering every category in the published price list —
crown tiers, bridges, inlays, veneers, dentures, retainers, guides by
implant count, all five aligner tiers, Signature Match finishing, the
quote-on-request refusals, and that GST is added on top exactly once.

**Run it after touching `server/lib/pricing.js`.** Every figure in the
file is quoted from the price list; if one fails, either the list changed
(update both) or the engine has drifted from what clinics were promised.

---

## How the system fits together

### Pricing

`server/lib/pricing.js` owns every pricing rule; nothing else does price
arithmetic. `quoteCase()` returns `{ lines, netPaise, gstPaise, totalPaise }`.

Published prices are **exclusive of GST, and 5% is added on top** — see
`GST_RATE` in `server/lib/config.js`. GST is applied once, at the bottom of
the quote. Categories the price list does not cover yet (splints and
nightguards, pediatric aligners, posterior bite blocks, full-arch guides)
are **refused by the API rather than priced at zero**.

`GET /api/catalog/pricing-rules` exposes aligner tiers, guide pricing,
veneer rules and the quote-on-request list to the client, so the live
estimate in the New Case form mirrors the server exactly.

### Case lifecycle

```
submitted → cad_assigned → design_ready → awaiting_doctor_approval
  → design_approved → batched → printing → printed → finishing → qa
  → ready_for_dispatch → (payment) → packaged → dispatched → completed
```

Transitions are enforced by `VALID_TRANSITIONS` **and** `TRANSITION_ROLES`
in `server/routes/cases.js`, plus a clinic-ownership check. Standard-tier
cases skip `finishing` (`printed → qa`); only Signature Match goes to a
ceramist.

### Doctor design approval

The dentist signs off on the CAD design before anything prints — the price
list promises *"Nothing prints until you say yes."* When lab QC passes, the
case moves to `awaiting_doctor_approval` with a deadline (24h, or 6h for
priority work).

`runDesignApprovalSweep()` in `server/lib/strikeScheduler.js` runs every
five minutes: it reminds at 25% and 75% of the window, and at the deadline
either auto-approves (if the clinic opted in via `autoApproveDesigns`) or
escalates to the lab manager. It never auto-approves a case with no
assigned technician, and never escalates the same case twice.

**Two kinds of work never auto-approve, whatever the clinic's preference**
— surgical guides, and anything above `AUTO_APPROVE_MAX_VALUE_PAISE`
(₹20,000). Both escalate to a human instead. See
`AUTO_APPROVE_EXCLUDED_CASE_TYPES` in `server/lib/config.js`.

### Payment

`totalAmountPaise` is the GST-inclusive figure the clinic actually pays.
Paying does **not** dispatch a case: it returns to `ready_for_dispatch`
(paid, awaiting packing), someone still has to pack it, and moving to
`dispatched` requires a courier and a consignment number.

A clinic in wallet mode is auto-debited at `ready_for_dispatch`; a partial
balance is drawn down and the remainder billed by link. The wallet has a
floor and cannot go negative.

### Case records and export

Every case is auditable after the fact. Alongside the clinic-facing
`Timeline`, each case now writes `AuditLog` rows carrying **actor, role,
IP, before/after state and a reason** for creation, every status change,
field-level edits, assignment, design approval or revision, and file
upload or deletion. Previously only *forced* admin overrides were
recorded, so a case that moved through the pipeline normally left no
trace of who moved it.

Worker columns name the person **and** the account the work was done
from — `Arjun Deshpande (cad_001)` — because a role label identifies
nobody once there are two designers on the bench. "Approved by" names
the actual approver, or says *System — auto-approved at deadline* when
the SLA sweep resolved it.

**Admin → Case Records** produces a period statement. **Admin only** —
this is the one place where every case, clinic and rupee sit in a single
downloadable file:

| | |
|---|---|
| Ranges | Today, Yesterday, Last 7, Last 30, This month, or a custom from/to |
| Preview | The same rows and totals the spreadsheet will contain |
| Download | Real `.xlsx` — two sheets, frozen header, autofilter, date and currency cells that Excel can sort and sum |
| Email | Sends the workbook to the requesting admin's **own** address only |

The statement deliberately includes cancelled and archived cases: an
export that quietly drops them is worse than none, because it reads as
complete. Money is back-computed from `totalAmountPaise` — what was
actually charged — rather than re-priced from the current price list.

```
GET  /api/records/cases?preset=last7
GET  /api/records/cases.xlsx?preset=custom&from=2026-08-01&to=2026-08-12
POST /api/records/cases/email?preset=last30
GET  /api/records/cases/:customId/history
```

`…/history` returns one merged, chronological stream of audit rows,
timeline entries and file events for a single case.

### Who sees money

| | Manager | Admin |
|---|---|---|
| Clinic balance, outstanding, credit limit, utilisation | ✅ | ✅ |
| Wallet ledger — lifetime loaded/spent, transactions | ❌ | ✅ |
| Grant Net-30 terms, set credit limits | ❌ | ✅ |
| Month-end invoice generation | ✅ | ✅ |
| Lab revenue / turnover / GST collected | ❌ | ✅ |
| Case Records export | ❌ | ✅ |

Setting a credit line decides how much a clinic may owe, so it is a
financial decision rather than an operational one — `billing.set_terms`
is admin-only. It lives at **Admin → Hesyra Wallets → Credit terms**,
because an admin cannot reach `/manager/clinics` (that route requires
exactly the manager role). Month-end invoicing bills work already
dispatched and derives its amounts, so it stays with operations under
`billing.generate_invoices`.

A manager decides whether a case dispatches, and that turns on whether a
prepaid clinic has funds or a Net-30 clinic is inside its limit — so
they get the **standing**. They do not get the history: no dispatch
decision needs to know a clinic topped up ₹5,000 last Tuesday. The
ledger fields are withheld by `GET /api/manager/clinics/:id/wallet`
itself for a manager, not merely hidden in the UI.

There is no lab-wide revenue figure anywhere in the manager interface
and no endpoint that would produce one. The single aggregate a manager
sees is total outstanding credit, which is a collections number rather
than turnover.

### Scan Day

The lab's scanner visits a clinic, which opens a **seven-day qualifying
window**. Five crown orders inside it earn **+1 free crown**, twenty earn
**+5**, and the tiers stack. Crowns are issued in the clinic's most-ordered
tier and expire after 90 days.

Rewards are a redeemable `CrownCredit` against a future crown — **never
wallet money, and not exchangeable for cash**. Complimentary crowns do not
themselves count towards earning more. Staff log visits at
**Operations → Scan Day**; clinics see their standing on the dashboard and
apply a crown from the New Case summary.

---

## Not production-ready yet

- **Live Razorpay is not implemented.** `server/lib/razorpay.js` throws on
  the live path. `RAZORPAY_MODE=test` routes through
  `/api/payment/simulate/:caseId`, which is gated to the owning clinic or
  an admin/manager. **Real payments cannot be taken until this is wired
  up** — it is the single biggest launch blocker.
- **Email is configured, not assumed.** The only feature that sends mail
  is the admin case-statement export, via SMTP settings in
  `server/.env` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, optionally
  `SMTP_USER` / `SMTP_PASS`). With those unset the "Email to me" button
  is disabled and says why; Preview and Download are unaffected.
  **Nothing else in the portal sends email** — notification preferences
  still gate in-app alerts only, and the Settings UI says so rather than
  promising mail that never arrives.
- **`HESYRA_GSTIN` in `server/lib/config.js` is a placeholder** and must be
  set to the real registration before an invoice is issued to anyone.
- Layouts are verified at 1440×900, 1440×768 and 1920×1000.
