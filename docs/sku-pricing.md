# Hesyra Dental Lab — SKU Pricing System

> **Internal Reference Document**
> Last updated: July 2026
> All prices stored in paise internally (₹1 = 100 paise)

---

## 1. Finishing Tiers

Every prosthetic case gets a finishing quality tier. This is the main pricing lever beyond material choice.

### Studio Finish (`standard`)

- Professional glazing & polished contacts
- Standard shade matching from VITA Classical palette
- **Included in base price** — no additional charge

### ✨ Signature Match (`premium`)

- Hand-stained characterization by a ceramist
- Translucency layering matched to the patient's natural teeth
- **Requires:** Doctor uploads a well-lit digital photo of adjacent teeth at the time of case submission
- **Costs:** Base price + finishing upcharge (varies by case type — see table below)

---

## 2. Signature Match Upcharge Rates

| Case Type | Upcharge Rule | Amount |
|-----------|---------------|--------|
| Single Crown | Flat per crown | **₹199** |
| Multi-Unit Bridge | Per tooth in the bridge | **₹120 × tooth count** |
| Veneer | Flat per case | **₹500** |
| Denture | Flat per case | **₹500** |
| Surgical Guide | ❌ Not available | — |
| Splint / Guard | ❌ Not available | — |
| Retainer | ❌ Not available | — |

> **Note:** These upcharge rates are admin-editable in real time from the admin panel. The values above are the launch defaults.

---

## 3. Pricing Formula

```
Total = Base Cost + Signature Match Cost (if selected)
```

**Base Cost:**

| Case Type | Calculation |
|-----------|-------------|
| Crown & Bridge | `SKU basePrice × number of teeth` |
| All other types | `SKU basePrice × 1` (flat) |

**Signature Match Cost (only when `finishingTier = premium`):**

| Restoration | Calculation |
|-------------|-------------|
| Single Crown | `₹199` flat — regardless of tooth count |
| Multi-Unit Bridge | `₹120 × number of teeth` |
| Veneer | `₹500` flat |
| Denture | `₹500` flat |

---

## 4. Material Catalog

### 4.1 Crowns & Bridges

| # | Doctor Sees | Lab Internally Knows | Category | Base Price (per tooth) | Signature Match | Shade? |
|---|-------------|---------------------|----------|----------------------|-----------------|--------|
| 1 | Ceramic Ultra | Graphy Ceramic | Ceramic | ₹1,800 | ✅ Available | Yes |
| 2 | Precision Zirconia | Rodin Zirconia | Zirconia | ₹2,500 | ✅ Available | Yes |
| 3 | BioResin Permanent | VarseoSmile Crown Plus | Resin | ₹1,500 | ✅ Available | Yes |
| 4 | BioResin Provisional | Temp C&B Resin | Resin | ₹800 | ❌ Studio only | Yes |

### 4.2 Veneers

| # | Doctor Sees | Lab Internally Knows | Category | Base Price | Signature Match | Shade? |
|---|-------------|---------------------|----------|-----------|-----------------|--------|
| 1 | Ceramic Ultra | Graphy Ceramic | Ceramic | ₹1,800 | ✅ +₹500 | Yes |
| 2 | Precision Zirconia | Rodin Zirconia | Zirconia | ₹2,500 | ✅ +₹500 | Yes |
| 3 | Porcelain Press | IPS e.max Press | Ceramic | ₹3,000 | ✅ +₹500 | Yes |

### 4.3 Dentures

| # | Doctor Sees | Lab Internally Knows | Category | Base Price | Signature Match | Shade? |
|---|-------------|---------------------|----------|-----------|-----------------|--------|
| 1 | Acrylic Pro | Lucitone Digital Print | Acrylic | ₹4,500 | ✅ +₹500 | Yes |
| 2 | FlexiResin | Valplast Flexible | Resin | ₹5,000 | ✅ +₹500 | Yes |

### 4.4 Surgical Guides

| # | Doctor Sees | Lab Internally Knows | Base Price | Finishing | Shade? |
|---|-------------|---------------------|-----------|----------|--------|
| 1 | Surgical Clear Resin | Dental SG Resin | ₹3,000 | Studio only | No |
| 2 | Surgical Autoclavable | Dental SG+ Autoclave | ₹4,000 | Studio only | No |

### 4.5 Splints & Guards

| # | Doctor Sees | Base Price | Finishing | Shade? |
|---|-------------|-----------|----------|--------|
| 1 | Rigid Guard Resin | ₹1,800 | Studio only | No |
| 2 | Flex Guard Resin | ₹2,000 | Studio only | No |

### 4.6 Retainers

| # | Doctor Sees | Base Price | Finishing | Shade? |
|---|-------------|-----------|----------|--------|
| 1 | Clear Retention Resin | ₹1,200 | Studio only | No |

---

## 5. Worked Examples

### 5.1 — Single Zirconia Crown · Studio Finish

```
Restoration:  Single Crown
Material:     Precision Zirconia
Teeth:        [21]  →  1 tooth
Finishing:    Studio Finish

Base          ₹2,500 × 1       =  ₹2,500
Upcharge      —                 =  ₹0
                                  ────────
TOTAL                              ₹2,500
```

### 5.2 — Single Ceramic Crown · Signature Match

```
Restoration:  Single Crown
Material:     Ceramic Ultra
Teeth:        [11]  →  1 tooth
Finishing:    ✨ Signature Match

Base          ₹1,800 × 1       =  ₹1,800
Upcharge      ₹199 flat         =  ₹199
                                  ────────
TOTAL                              ₹1,999
```

### 5.3 — 4-Unit Zirconia Bridge · Signature Match

```
Restoration:  Multi-Unit Bridge
Material:     Precision Zirconia
Teeth:        [21, 22, 23, 24]  →  4 teeth
Finishing:    ✨ Signature Match

Base          ₹2,500 × 4       =  ₹10,000
Upcharge      ₹120  × 4        =  ₹480
                                  ────────
TOTAL                              ₹10,480
```

### 5.4 — 3-Unit Ceramic Bridge · Studio Finish

```
Restoration:  Multi-Unit Bridge
Material:     Ceramic Ultra
Teeth:        [35, 36, 37]  →  3 teeth
Finishing:    Studio Finish

Base          ₹1,800 × 3       =  ₹5,400
Upcharge      —                 =  ₹0
                                  ────────
TOTAL                              ₹5,400
```

### 5.5 — Porcelain Veneer · Signature Match

```
Restoration:  Porcelain Veneer
Material:     Porcelain Press
Finishing:    ✨ Signature Match

Base          ₹3,000 × 1       =  ₹3,000
Upcharge      ₹500 flat         =  ₹500
                                  ────────
TOTAL                              ₹3,500
```

### 5.6 — Full Denture · Studio Finish

```
Restoration:  Full Denture (Upper)
Material:     Acrylic Pro
Finishing:    Studio Finish

Base          ₹4,500 × 1       =  ₹4,500
Upcharge      —                 =  ₹0
                                  ────────
TOTAL                              ₹4,500
```

### 5.7 — Partial Denture · Signature Match

```
Restoration:  Partial Denture
Material:     FlexiResin
Finishing:    ✨ Signature Match

Base          ₹5,000 × 1       =  ₹5,000
Upcharge      ₹500 flat         =  ₹500
                                  ────────
TOTAL                              ₹5,500
```

### 5.8 — Surgical Guide (Signature Match not available)

```
Restoration:  Surgical Guide
Material:     Surgical Autoclavable
Finishing:    Studio Finish (only option)

Base          ₹4,000 × 1       =  ₹4,000
Upcharge      —                 =  ₹0
                                  ────────
TOTAL                              ₹4,000
```

### 5.9 — Provisional Crown (Signature Match not available)

```
Restoration:  Single Crown
Material:     BioResin Provisional
Teeth:        [36]  →  1 tooth
Finishing:    Studio Finish (provisionals don't offer Signature Match)

Base          ₹800 × 1         =  ₹800
Upcharge      —                 =  ₹0
                                  ────────
TOTAL                              ₹800
```

---

## 6. Fallback Pricing (Legacy)

When no material SKU is selected (drafts, older cases), flat per-type pricing kicks in:

| Case Type | Flat Price |
|-----------|-----------|
| Crown & Bridge | ₹1,500 |
| Veneer | ₹2,000 |
| Denture | ₹4,500 |
| Surgical Guide | ₹3,000 |
| Splint | ₹1,800 |
| Retainer | ₹1,200 |
| Aligner | ₹2,500 |
| Model | ₹400 |

---

## 7. Validation Pipeline

The server runs these checks in order before calculating the price:

| Step | Check | If Fails |
|------|-------|----------|
| 1 | Does `materialSkuId` exist in `MaterialSKU` table? | `400: Selected material does not exist.` |
| 2 | Is the SKU `active: true`? | `400: {name} is currently out of stock.` |
| 3 | Does the SKU's `caseTypes` include the submitted case type? | `400: {name} is not available for {type} cases.` |
| 4 | If `finishingTier = premium`, is a reference photo uploaded? | Form blocks submission on the frontend |

---

## 8. Role-Based Visibility

| What | Doctor | Manager | Admin | Technician | Ceramist |
|------|--------|---------|-------|------------|----------|
| Material display name | ✅ | ✅ | ✅ | ✅ | ✅ |
| Supplier name (internal) | ❌ | ✅ | ✅ | ✅ | ✅ |
| Base price | ❌ | ❌ | ✅ Edit | ❌ | ❌ |
| Upcharge rates | ❌ | ❌ | ✅ Edit | ❌ | ❌ |
| Stock toggle | ❌ | ✅ Toggle | ✅ | ❌ | ❌ |
| Stock notes | ❌ | ✅ | ✅ | ✅ | ❌ |
| Reference photo | ❌ | ✅ | ✅ | ❌ | ✅ |
| Case finishing tier | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 9. Where Prices Are Stored

| Setting | Location | Who Can Change |
|---------|----------|---------------|
| Per-SKU base prices | `MaterialSKU.basePrice` in database | Admin only |
| Signature Match upcharges | `MaterialSKU.premiumUpcharge` in database | Admin only |
| Legacy flat prices | `server/lib/config.js` → `CASE_PRICING_PAISE` | Code deploy only |
| Stock on/off | `MaterialSKU.active` in database | Manager via Material Catalog page |
| Shade palette | Hardcoded VITA Classical in frontend | Code deploy only |

---

## 10. Code References

| File | What It Does |
|------|-------------|
| `server/routes/cases.js` (POST `/api/cases`) | SKU validation + pricing calculation |
| `server/routes/catalog.js` | Material catalog CRUD API |
| `server/lib/config.js` | Fallback flat pricing table |
| `server/lib/paymentEngine.js` | `calculateOrderAmount()` for legacy cases |
| `server/seed.js` | Initial SKU seed data |
| `server/prisma/schema.prisma` → `MaterialSKU` | Database model |
| `src/pages/NewCase/NewCase.jsx` | Doctor-facing material picker + tier selector |
| `src/pages/Manager/ManagerCatalog.jsx` | Manager stock management UI |
