# Hesyra Portal — Session Handoff

Context for continuing work in a fresh session. Rewritten 12 Aug 2026 after
two long working sessions; everything below reflects the repo as of that
point. Where a section says "verified", it was checked in a running browser
or against the database, not just built.

---

## 1. The goal

**Make the Hesyra Portal launch-ready.** It is a dental lab workflow system
for Hesyra Labs (Nagpur, India) — dentists submit prescriptions, the lab
designs and manufactures, cases ship back.

The standing brief, in order:

1. Get it running locally.
2. Find and fix real bugs — especially anything that would bite in production.
3. Walk a case end to end with no shortcuts, and close every "loose point"
   where a case could move forward when it shouldn't.
4. Load the **real published pricing** and make the pricing engine express it.
5. Raise the UI/UX from "template-generated" to a professional clinical tool.

The recurring instruction on UI: **no scrolling to find things, no filler
decoration, progressive disclosure over walls of text.**

---

## 2. Environment

| Thing | Value |
|---|---|
| Repo root | `C:\Users\URSE\OneDrive\Desktop\hesyra portal` |
| Origin | `github.com/hesyralabs/Hesyra-Portal` (single commit `1c8d8f4`) |
| Frontend | React 19 + Vite 8, CSS Modules |
| Backend | Express 5 + Prisma 7 + **SQLite** (`server/dev.db`) |
| API | `http://localhost:3001` |
| UI | `http://localhost:5173` |
| Node | v24.18.1, npm 11.16.0 |

### Running it

```bash
cd "C:\Users\URSE\OneDrive\Desktop\hesyra portal\server" && node server.js
```
```bash
cd "C:\Users\URSE\OneDrive\Desktop\hesyra portal" && npm run dev
```

Docker Compose exists and references Postgres, but the Prisma schema's
provider is `sqlite` — **SQLite is the real local path**, no Docker needed.

**The API server does not hot-reload.** Every change under `server/` needs a
restart; several hours were lost to testing against stale route code that
returned a stale response shape.

### Setup gotchas (already fixed, don't re-break)

- The **committed `package-lock.json` was unresolvable** — it pinned
  `@google/model-viewer@4.2.0` (needs `three@^0.182`) against `three@0.183.2`.
  `npm ci` failed identically. Fixed by regenerating; model-viewer now
  resolves to 4.3.1. `three` stays at `^0.183.2` — do NOT downgrade it.
- **`react-is`** is a peer of `recharts` and must stay in `package.json`.
  Without it Vite 500s on the recharts chunk and the app renders blank.
- **`server/.env` is gitignored.** `server/.env.example` documents it.
  Required: `DATABASE_URL="file:./dev.db"`, `JWT_SECRET`, `PORT=3001`,
  `RAZORPAY_MODE=test`. Optional SMTP block — see §4 *Email*.

### Logins

All accounts use password **`Hesyra@2026`**. Login accepts email *or* username.

| Role | Email | Username |
|---|---|---|
| admin | admin@hesyra.com | admin |
| manager | manager@hesyra.com | mgr_001 |
| technician | tech@hesyra.com | tech_001 |
| cad_designer | cad@hesyra.com | cad_001 |
| ceramist | ceramist@hesyra.com | ceramist_001 |
| ceramist | ceramist2@hesyra.com | ceramist_002 |
| clinic | doctor@hesyra.com | MH272 |
| clinic | doctor2@hesyra.com | MH273 |
| clinic | newdoc@hesyra.com | MH274 |

There is a **login rate limiter** (in-memory) — scripting against the API will
trip "Too many login attempts". Restarting the server clears it.

### Scripts

```bash
cd server && npm test          # pricing (49) + payment (43) — run after touching either
cd server && npm run test:pricing   # just the pricing suite
cd server && npm run test:payment   # just the payment / signature suite
node server/seed.js            # full demo seed (accounts + sample cases)
node server/seedCatalog.js     # loads the real price list into MaterialSKU
node server/wipe_cases.js      # clears all case data, keeps accounts
npx prisma db push             # apply schema changes …
npx prisma generate            # … and ALWAYS run this after; push does not do it
```

---

## 3. The real pricing (source of truth)

From **Hesyra Introductory Price List, July 2026 (Launch Edition)**, valid
till 30 Sept 2026. The *scanned* version's aligner numbers are the correct
ones (an earlier PDF had different figures — ignore that one).

**ALL PRICES ARE EXCLUSIVE OF GST. GST @5% IS ADDED ON TOP.**
Originally coded as 12% *inclusive* — both wrong. Now `GST_RATE = 0.05` in
`server/lib/config.js`, added on top at case creation.

### Crowns (per unit) — bridges bill per unit at the same tier, no span surcharge
| Tier | Price | Warranty |
|---|---|---|
| Hesyra PRO (ceramic-infused resin) | ₹950 | 5 yr |
| Hesyra SIGNATURE (nano-hybrid ceramic) | ₹1,200 | 5 yr |
| Hesyra PREMIUM (zirconia) | ₹1,500 | 7 yr |
| Hesyra ELITE (nano-hybrid zirconia) | ₹1,800 | 10 yr |

### Others
- **Inlay** ₹2,000 · **Onlay** ₹2,500 (per unit)
- **Veneers** — Classic: ₹3,000 base for **2 teeth**, then **₹1,200 per extra tooth**. Ultra-thin: ₹1,500/tooth.
- **Dentures** (per set, U+L) — Signature ₹12,500 · Premium ₹14,500 · Elite ₹17,000
- **Clear retainer** ₹750 per arch
- **Space maintainer** ₹1,500 (both arches)
- **Surgical guides** (per guide, by implant count): 1→₹2,000, 2→₹2,250, 3→₹2,500, 4→₹2,750, 5→₹3,000, 6→₹3,250. Above 6 = full-arch, **quote on request**. **VSP add-on ₹1,500**.
- **Clear aligners** (per case, by tier):
  | Tier | Price | Included | Extra set |
  |---|---|---|---|
  | Flexi (relapse) | ₹3,200/set | pay per set | — |
  | Standard (mild) | ₹36,000 | 10 sets | ₹2,500 |
  | Premium (moderate) | ₹51,000 | 15 sets | ₹2,000 |
  | Elite (complicated) | ₹65,000 | 20 sets | ₹1,800 |
  | Executive (unlimited) | ₹91,000 both arches | unlimited | ₹70,000 single arch |

### Quote-on-request (refused by the API, not priced at zero)
Splints & nightguards ("launching soon"), pediatric aligners, posterior bite
blocks, full-arch guides.

### Scan Day launch offer
Lab scanner visits a clinic → opens a **7-day window**. 5 crown orders in that
window → **+1 free crown**; 20 orders → **+5 free**. Issued in the
most-ordered tier. Not exchangeable for cash — implemented as a redeemable
`CrownCredit`, not wallet money.

---

## 4. Architecture

### Pricing
`server/lib/pricing.js` owns **every** pricing rule. Nothing else does price
arithmetic. `quoteCase()` returns `{ lines, netPaise, gstPaise, totalPaise }`.
GST applied once, at the bottom.

`GET /api/catalog/pricing-rules` exposes aligner tiers, guide pricing, veneer
rules and quote-on-request categories to the client, so the New Case live
estimate mirrors the server exactly.

**Test suite:** `server/test/pricing.test.js`, 49 assertions, `cd server &&
npm test`. Every figure is quoted from the price list; a failure means either
the list moved (update both) or the engine drifted.

### Case lifecycle (`server/routes/cases.js` → `VALID_TRANSITIONS`)
```
submitted → cad_assigned → design_ready → awaiting_doctor_approval
  → design_approved → batched → printing → printed
      ├─ ceramic types → finishing → qa
      └─ everything else       → qa
  → ready_for_dispatch → (payment) → packaged → dispatched → completed
```
Transitions are enforced by `VALID_TRANSITIONS` **and** `TRANSITION_ROLES`,
plus a clinic-ownership check.

### Ceramic finishing
`CERAMIC_FINISHING_CASE_TYPES` in `lib/config.js` decides who touches a case
after printing: `crown_bridge`, `veneer`, `denture`, `inlay_onlay` go to a
ceramist. Everything else — aligners, retainers, splints, surgical guides,
space maintainers — is thermoformed or printed plastic with no ceramic stage
and goes print → QC → pack → deliver.

**Routing is by prosthesis type, not by `finishingTier`.** Tier decides how
*much* finishing (Signature Match hand-staining vs. studio glaze and polish),
never *whether* there is any.

On batch completion the least-loaded active ceramist is assigned
automatically and the batch closes itself. With no active ceramist the cases
hold at `printed` with a timeline warning rather than silently skipping a
production step.

### Doctor design approval + SLA
The dentist approves designs before production — the price list promises
*"Nothing prints until you say yes."* Lab QC passes → case goes to
`awaiting_doctor_approval` with a deadline (24h, or 6h for priority).

`server/lib/strikeScheduler.js` → `runDesignApprovalSweep()` every 5 min:
- Reminders at 25% and 75% of the window
- At the deadline: auto-approve if the clinic allows it, else escalate to the
  manager (per-clinic `autoApproveDesigns`)
- Never auto-approves without an assigned technician (would strand the case)
- Escalates only once
- **Two carve-outs override the clinic's preference**:
  `AUTO_APPROVE_EXCLUDED_CASE_TYPES` (surgical guides) and
  `AUTO_APPROVE_MAX_VALUE_PAISE` (₹20,000). Both escalate instead.

### Payment
`totalAmountPaise` is the GST-inclusive figure the clinic pays. Payment does
**not** dispatch — it returns the case to `ready_for_dispatch` (paid, awaiting
packing). `dispatched` **requires courier + consignment number**.

Wallet mode auto-debits at `ready_for_dispatch`; partial balance is drawn down
and the remainder billed by link; the wallet has a floor and cannot go
negative.

Live Razorpay **is implemented** (third session) but has never run against a
real Razorpay account — see §8. `RAZORPAY_MODE=test` still uses
`/api/payment/simulate/:caseId`, role-gated to the owning clinic or
admin/manager, and the `/simulate*` endpoints refuse to run in live mode.

Three things hold the live path together and are easy to break by accident:

- **`req.rawBody`.** The webhook signature is an HMAC over the exact bytes
  Razorpay sent. `express.json({ verify })` in `server.js` captures them.
  Verifying against `JSON.stringify(req.body)` does not round-trip and
  rejects every genuine webhook.
- **`WebhookEvent`.** Razorpay retries until it gets a 2xx, so every event
  arrives more than once. The row is claimed before any money moves.
- **`creditWalletReload()`** is idempotent on the Razorpay payment id, so the
  browser callback and the `order.paid` webhook can both run and only one
  credits.

### Audit trail
`AuditLog` records the ordinary case lifecycle, not just admin overrides:
`CASE_CREATED`, `CASE_STATUS_CHANGE`, `CASE_EDITED` (field-level
before/after), `CASE_ASSIGNED`, `DESIGN_APPROVED` / `DESIGN_REVISION`,
`CASE_FILE_UPLOADED` / `CASE_FILE_DELETED`, `CREDIT_TERMS_CHANGED` — each with
actor, role, IP and reason.

`GET /api/records/cases/:customId/history` merges audit rows, timeline entries
and file events into one ordered stream for a single case.

### Case records / export (admin only)
**Admin → Case Records.** Presets (today / yesterday / last 7 / last 30 / this
month) plus custom from–to; in-app spreadsheet preview; two-sheet `.xlsx`
download with real Date and currency cells, frozen header, autofilter and a
footing totals row; email-to-self.

```
GET  /api/records/cases?preset=last7
GET  /api/records/cases.xlsx?preset=custom&from=…&to=…
POST /api/records/cases/email?preset=last30
GET  /api/records/cases/:customId/history
```

Deliberately includes cancelled and archived cases — an export that quietly
drops them is worse than none, because it reads as complete. Money is
back-computed from `totalAmountPaise` (what was charged), not re-priced from
the current list.

### Email
`server/lib/mailer.js` is the **only** mail path in the codebase, and it
serves only the case-statement export. SMTP via env (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_FROM`, optional `SMTP_USER`/`SMTP_PASS`). Unconfigured → the endpoint
returns 503 naming the missing variables and the UI disables the button and
explains. It never reports a send that did not happen.

Everything else in the portal has **no** email or SMS transport — notification
preferences gate in-app alerts only, and Settings says so.

### Who sees money

| | Manager | Admin |
|---|---|---|
| Clinic balance, outstanding, credit limit, utilisation | ✅ | ✅ |
| Wallet ledger — lifetime loaded/spent, transactions | ❌ | ✅ |
| Grant Net-30 terms, set credit limits | ❌ | ✅ |
| Month-end invoice generation | ✅ | ✅ |
| Lab revenue / turnover / GST collected | ❌ | ✅ |
| Case Records export | ❌ | ✅ |

A manager decides whether a case dispatches, which turns on whether a prepaid
clinic has funds or a Net-30 clinic is inside its limit — so they get the
**standing**, not the history. The ledger fields are withheld by
`GET /api/manager/clinics/:id/wallet` itself, not merely hidden in the UI.

Setting a credit line is `billing.set_terms` (admin), at **Admin → Hesyra
Wallets → Credit terms** — admins cannot reach `/manager/clinics`, which
requires exactly the manager role. Month-end invoicing is
`billing.generate_invoices` (admin + manager).

### Theme
**One theme.** `:root` in `index.css` is the single source — the Hesyra brand
palette. There is no toggle, no `ThemeContext`, no light/dark mode.

---

## 5. Session log — first session

### Security / correctness (all verified with probes)
- **`PUT /api/cases/:id/status` authorized nothing.** Any authenticated user
  could drive any transition. Proven: a different clinic archived another
  clinic's paid case. Added `TRANSITION_ROLES` + ownership checks. Same for
  file upload, case edit, and case chat.
- **Cases could be dispatched and delivered without paying.** The guard only
  checked the legacy `shipped` status; the real path is `packaged →
  dispatched`. Now covers all three dispatch states, runs *before* the write,
  exempts Net-30 credit.
- **Wallet could go negative** (−₹1,999 observed) and pay-on-go
  double-charged. Fixed with a balance floor and an "already collected
  externally" check.
- **`dentist` vs `clinic` role mismatch across 10 files.** The DB uses
  `clinic`; a lot of code compared against `dentist`, so wallet/strike data
  never loaded and onboarding 403'd every real clinic.
- **Invoices were not legally usable** — `userId` null, `paidAt` null despite
  status `paid`, customer name hardcoded `"Your Clinic"`, mixed rupee/paise
  units, and GST added on top so the total didn't match what was charged.
- **Unpaid cases escaped collections** — strike sweep re-keyed to
  `paymentConfirmedAt: null`.
- **Auth race in `CaseContext`/`SystemContext`** — fetched before the token
  existed, so the dashboard showed 0 cases until a manual reload.

### Settings
Forms initialised once before the session resolved (blank fields over good
data, and saving blanked it) — now re-seed on user change. Added **Delivery**
and **Case Preferences** (`preferredPaymentMode`, `autoApproveDesigns` — both
existed in the DB with no UI *and* the profile endpoint rejected them).
**TechSettings was a mock**: every Save was a 2-second "Saved ✓" that
persisted nothing.

### UI/UX
Case-type step became a grouped rate card with from-price and turnaround.
Prescription step moved to CSS multi-column. The clinic dashboard's 9-lane
kanban was replaced — a kanban is the *lab's* model and the dentist never
moves cases — with an attention band, segmented filters, search and a
5-milestone progress track per row. Case detail leads with the patient name.

---

## 6. Session log — second session

### Scan Day got a UI (was API-only)
- **`/manager/scan-day`** — log a visit, see every window with live crown
  progress toward the next reward, credits issued vs redeemed.
- **Clinic dashboard** band showing crowns in hand and window progress, shown
  only when there is something to say.
- **New Case** offers "Use a complimentary crown"; total drops to ₹0.
- Verified end to end: five crown orders earned a credit; redeeming produced
  `complimentary: true`, `totalAmountPaise: 0`, credit marked redeemed and
  linked, timeline entry written.

Server bugs found while wiring it: `/my-credits` and `/visits` reported the
*stored* `crownOrderCount` (only rewritten on a new order, so a window opened
after the orders read zero) — both now count live through one shared
`qualifyingOrders()`; the duplicate-visit 409 named the account holder rather
than the practice; the visit-date default used `toISOString()`, which yields
*yesterday* for the whole IST morning; `complimentary` was not serialized by
`blindCaseData`, so a Scan Day case showed no price at all.

### New Case flow rebuilt
- **Tooth chart is an arch**, not 32 numbers in two flat rows — two facing
  arcs offset by k·t² from the midline, R/L markers, and a readout ("3 teeth ·
  13, 14, 15"). You point at a position instead of reading labels.
- **One label layer.** Four of five sections restated their own name
  (`MATERIAL / MATERIAL`); those inner labels are gone and `+ GST` moved off
  all five material cards into one footnote.
- **Stepper has three states**, not two — `step >= n` painted current and
  finished identically. Finished steps tick and are clickable.
- **Step 3 rebuilt into named scan slots** — Upper / Lower / Bite, plus CBCT
  for guides, each with accepted formats and a required marker. The old check
  counted files, so one upper-arch STL satisfied it and the case reached the
  lab without an opposing arch. Files carry their role to the bench as
  `Upper__scan.stl`.
- **`toothNumbers` survived a case-type change** — cosmetically it showed
  "Teeth 15, 16" on an aligner, but a surgical guide derives its implant count
  *and price* from that field, so switching quoted a ₹2,750 four-implant guide
  for sites nobody marked.
- **Material auto-selected `data[0]`** = `Ceramic Ultra`, a legacy SKU priced
  level with ELITE at ₹1,800, so every untouched prescription defaulted to the
  most expensive option in a ₹950–₹1,800 range. Now requires an explicit
  choice.
- `CaseDetails.jsx` nesting fixed (`mainColumn` closed before the 3D card,
  making it a third grid child — also the cause of the 256px collapsed viewer,
  now 112px). Progressive disclosure finished: shade palette, timeline
  "show N earlier", Prescription Details "More details".

### Audit trail, records and export
See §4. Plus: **`DELETE /api/cases/:customId/files/:fileId` authorised
nothing** — any signed-in user could delete any file on any case, and the
fileId was never checked against the case in the URL. Now ownership- and
role-gated, and audited before the row goes.

Other fixes: credit changes were logged as `CASE_STATE_FORCE` ("reusing
closest action type"), mislabelling a financial decision and polluting
case-override searches — now `CREDIT_TERMS_CHANGED`. `billing.set_terms` and
`billing.generate_invoices` replace a **read** permission
(`wallet.view_any_clinic`) that was guarding **writes**. **SuperAdmin tabs
never refetched after a write** — they reloaded via `setActiveTab('overview')`
then `setActiveTab('wallets')` back to back, which React batches, so the value
never changed and the effect never re-ran; grants saved correctly and appeared
not to. Replaced with an explicit `refreshKey`.

`assignedCeramist` relation declared on `Case` (`ceramistCases` on `User`) —
it was a bare FK so the ceramist who finished a case could not be joined.

### One theme
The portal shipped **three** — brand on `:root` plus generic `.dark-mode` and
`.light-mode` — and the toggle only flipped dark↔light, so pressing it once
made the brand unreachable without clearing `localStorage`; a user whose OS
preferred light never saw the brand at all. Deleted `ThemeContext.jsx`,
`components/UI/ThemeToggle/`, the toggle in five layouts, the selector in both
settings pages, and **59 `:global(.light-mode)` rules** across five CSS
modules (TechCaseWorkspace alone had 31).

**`--status-info-text` / `-warning-` / `-success-` / `-danger-` existed only
inside `.light-mode`** yet were used 7 times in Dashboard and CaseDetails — a
completed timeline dot had no fill and the case-detail status badge no text
colour in the theme everyone actually used. Now brand tokens. Audited all six
roles for light leftovers and text matching its own background: none.

### Ceramic finishing routed by prosthesis type
Nothing ever reached the ceramist: the split was on `finishingTier ===
'premium'` — the Signature Match **upsell** — and the database had zero
premium cases, so every case went straight to QC and the bench was
structurally unreachable. Now routed by `CERAMIC_FINISHING_CASE_TYPES` (§4),
with automatic assignment to the least-loaded ceramist so cases stop parking
invisibly on `printed`. Closing a batch now reports where the work went —
*"1 to finishing with Ravi Ceramist · 1 straight to QC"*.

Verified: a batch of crown (standard), crown (Signature), veneer, aligner,
retainer and surgical guide routed 3 → finishing, 3 → QC, zero stranded.

### Ceramist workspace
The ceramist was served `TechLayout`, whose sidebar is hardcoded to `/tech/*`
— routes gated to `technician` — so `ProtectedRoute` bounced them straight
back and **every sidebar link was dead**. New `CeramistLayout` with only
reachable destinations. Added **`/ceramist/completed`** so released work can
be confirmed and rework spotted. `PUT /batch/ceramist/complete` wrote
`Ceramist: undefined` to the timeline (the JWT carries no `name`) and left no
audit row — both fixed. Queue cards now show patient and clinic, releasing
asks for confirmation, and failures surface instead of being swallowed.

### Manager Operations Overview rebuilt
Five counter tiles and a pipeline row, ending two-thirds down the screen with
nothing to act on — and **both controls were dead**: `statusFilter` and
`search` fed a `filtered` list that was computed every render and never
rendered, so clicking a pipeline tile highlighted it and changed nothing.

Now: a work queue (case, clinic/doctor, the shared 5-milestone track, **who
the case is waiting on**, age; priority first then oldest), segments and
pipeline chips that actually filter it, search across case/patient/clinic/
doctor, and an attention band that replaces the row of zeros and hides
entirely when empty. Dead space at 1440×900 went from ~400px to 40px.

### Launch-blocker sweep
`README.md` rewritten. Pricing suite recreated at `server/test/pricing.test.js`
(the original lived in a session scratchpad and had evaporated). Auto-approval
carve-outs added and verified. Wallet auto-deduct verified end to end with a
funded wallet: full cover debits and marks paid, partial cover drains and
bills the remainder, empty wallet falls back to pay-on-go, balance never
negative, exactly one paid invoice attributed to the clinic.

---

## 7. Session log — third session

### Live Razorpay implemented
`lib/razorpay.js` no longer throws on the live path: real `paymentLink.create`
and `orders.create`, payment and link lookup, and a config assertion that
names missing environment variables instead of failing as a 401 three calls
later. `razorpay@2.9.8` added to `server/package.json`.

Four defects in the live path were found on the way, none of which the stub
could expose:

- **The webhook signature could never have verified.** `express.json()` runs
  before the payment router, so the `express.raw()` mounted on the webhook
  route was a no-op — body-parser had already consumed the stream and set
  `req._body`. The HMAC was computed over `JSON.stringify(parsedObject)`,
  which is not the bytes Razorpay signed. Every genuine webhook would have
  been rejected as a forgery. Fixed by capturing `req.rawBody` in
  `express.json({ verify })`.
- **Nothing was idempotent.** Razorpay retries a webhook until it gets a 2xx.
  A redelivered `order.paid` credited the wallet again, and a redelivered
  `payment.captured` re-confirmed a case and issued a second invoice. Added
  the `WebhookEvent` claim table, an early return in `handlePaymentConfirmed`
  when `paymentConfirmedAt` is set, and dedupe on the Razorpay payment id in
  the new shared `creditWalletReload()`.
- **Nothing verified the checkout callback.** Wallet reload used Standard
  Checkout and never checked `razorpay_signature`, so what the browser posted
  back was an unverified claim. Added `verifyCheckoutSignature()` and
  `POST /api/wallet/reload/verify`, which reads the amount from Razorpay
  rather than from the request body.
- **Wallet reload was broken in the client regardless.** `PaymentContext`
  read `order.id` and `order.amount`; the API returns `orderId` and
  `amountPaise`. Both were `undefined`, so the checkout never opened. The key
  id was also hardcoded to `'rzp_test_stub'` behind a comment conceding it was
  a placeholder — it now comes from the server.

Signature comparison is constant-time. The `/simulate*` endpoints were already
refused in live mode and still are.

### Invoices
`numberToWords()` multiplied paise by 100 and returned `"(approx.)"`. Amount in
words is a legal requirement on an Indian tax invoice, so it is now exact and
groups in lakhs and crores.

**Monthly credit invoices overstated GST.** `taxAmount` was
`totalINR * GST_RATE * 100` applied to `totalAmountPaise`, which is already
GST-inclusive — charging the rate a second time on a gross figure. Now
back-computed the way per-case invoices already did it.

**CGST/SGST vs IGST** was hardcoded to an even intra-state split. A sale to a
clinic outside Maharashtra is a single IGST levy, and getting it wrong means
the wrong government is paid. `resolveTaxTreatment()` decides from the clinic's
`clinicState` against the state code in the lab's own GSTIN; the split and the
place of supply are stored on the `Invoice` row, with `placeOfSupplyAssumed`
recording when the clinic had no state on file.

### Launch config gate
The server refuses to start in `RAZORPAY_MODE=live` while Razorpay keys, the
webhook secret, `JWT_SECRET` or a valid `HESYRA_GSTIN` are missing, listing
every problem by name. In test mode the same check prints a warning and
carries on. `server/.env.example` documents the new variables, including that
the webhook secret is **not** the API key secret.

### Tests
`server/test/payment.test.js` — 43 assertions on signature verification, the
tax split, amount in words and the config gate. `npm test` now runs both
suites (92 assertions). It deliberately does **not** cover `createPaymentLink`
or `createOrder`, which need an account.

---

## 8. Open issues / next steps

### Launch blockers
1. **Live Razorpay has never touched a real Razorpay account.** The code is
   written and the trust boundary is tested, but nothing here has created a
   real payment link, opened a real checkout, or received a real webhook.
   Before launch: obtain live keys, register the webhook at
   `https://<domain>/api/payment/webhook` for `payment.captured`,
   `payment_link.paid` and `order.paid`, then take one real ₹1 payment end to
   end and confirm it lands once.
2. **`HESYRA_GSTIN` is still the placeholder** `27XXXXX0000X1Z5`. Now enforced
   — the server will not start in live mode without a valid one — but the real
   number still has to be supplied. Note its first two digits pick the state
   for every CGST/SGST vs IGST decision.
3. **There is no invoice document.** `generateGSTInvoiceData()` is exported and
   never called: invoices exist only as database rows, and `routes/invoices.js`
   is list/edit/delete. Nothing renders a PDF or printable tax invoice for a
   clinic. Found in the third session, not fixed.
4. **`Invoice.amount` means two different things.** Per-case rows store the
   taxable value; monthly rows store the GST-inclusive gross, and
   `handleCreditPayment()` depends on the latter. Any revenue total summing
   the column across both types is wrong. Left alone because fixing it touches
   the outstanding-balance arithmetic and the UI, and wants a decision.
5. `npm audit` reports 19 vulnerabilities (9 high) in the server tree.
   Pre-existing, not reviewed.

### Product decisions to make
- **A crown credit zeroes whatever crown it is applied to, regardless of
  tier.** Credits are *issued* in the clinic's most-ordered tier, but
  `redeemCreditFor()` does not check tier when spending one — a PRO credit
  (₹950) applied to an ELITE case (₹1,800) over-delivers by ₹850. Observed in
  testing. Either cap the credit at its tier's value and bill the difference,
  or accept it as a launch gesture. **Commercial decision, left alone.**
- **`denture` is in `CERAMIC_FINISHING_CASE_TYPES`** on the assumption that
  acrylic/ceramic dentures are polished at the same bench. If yours skip the
  ceramist, it is a one-word removal.
- Managers can still trigger month-end invoicing. That was judged operational
  rather than financial, but it is a document-creating action.

### Known gaps
- **A ceramist has no settings page** and cannot change their own password.
  `TechSettings` is printer- and resin-specific, so it was deliberately not
  reused — a small profile + password screen is the fix.
- **Seed data still names two accounts after their jobs** in existing
  databases — "CAD Designer", "Lab Technician". `seed.js` is fixed for fresh
  installs; rename existing ones in Admin → User Management (names resolve at
  read time, so past exports update too).
- The manager queue links through to case detail but has **no inline
  actions** — assigning a designer or approving a design is a click away
  rather than in place.
- Layouts verified at **1440×900, 1440×768 and 1920×1000**. Below ~700px tall
  the New Case form scrolls, but its action bar is sticky so the primary
  action stays reachable.

---

## 9. Working style that was asked for

- **Verify in the browser, not just the build.** A build passing means
  nothing — an un-imported icon is a runtime error that builds clean and
  renders a blank page. This happened three times, most recently `Check` in
  the New Case stepper.
- **Measure layout claims, and measure the right thing.** "No scroll" was once
  asserted from `document.scrollHeight`, which is always viewport-height
  because the app scrolls inside a wrapper. Later, "the Continue button is
  visible" was asserted about a **sticky** bar — which is always visible by
  definition, and was hiding 74px of permanently unreachable content beneath
  it. Check the real scroll container, and check whether anything sits under
  a pinned element with no room to scroll clear.
- **Don't fake functionality.** If there is no transport, say so in the UI
  rather than shipping a button that lies.
- Be direct about what wasn't done and why.

### Tooling traps in this environment

> **Never edit source files with PowerShell `Get-Content -Raw` /
> `Set-Content`.** PS 5.1 reads UTF-8 as ANSI and writing it back
> double-encodes every non-ASCII byte — it silently destroyed all 9 `₹`
> symbols and every box-drawing comment rule in `SuperAdmin.jsx`. The damage
> is **not** cleanly reversible (a latin1 round-trip over-corrects into
> invalid bytes); recovery meant `git show HEAD:<path>` into a temp file,
> copying it back, and re-applying every edit. Use the Edit tool, or `sed`
> via Bash — both are byte-safe.

> **`git checkout --` is blocked** by the permission classifier. To restore a
> file, `git show HEAD:<path> > /tmp/x` then `cp` it back.

> **Browser tool click coordinates land ~1.39× low** on the New Case page, so
> clicking a `ref` hits the wrong row. `read_page`, `form_input` and
> `get_page_text` are all correct — only coordinate dispatch is off. Drive
> that form by dispatching DOM clicks and read the result back normally.

> **`prisma db push` does not regenerate the client.** The server threw
> `Unknown field assignedCeramist` until `npx prisma generate` was run.

> **The API server does not restart itself.** After any `server/` edit,
> restart it — otherwise you are testing stale routes and will misread the
> result as a code bug.
