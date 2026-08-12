// ═══════════════════════════════════════════════════════════════════
// Payment Engine — Core Business Logic
// Separated from routes for testability and reuse.
// ═══════════════════════════════════════════════════════════════════

const prisma = require('./prisma');
const config = require('./config');
const razorpay = require('./razorpay');

/**
 * Calculate total order amount in paise.
 * Crown & Bridge: per-tooth pricing.
 */
function calculateOrderAmount(caseType, toothNumbers) {
  const basePrice = config.CASE_PRICING_PAISE[caseType] || config.CASE_PRICING_PAISE.default;

  if (caseType === 'crown_bridge') {
    let teeth = [];
    if (typeof toothNumbers === 'string') {
      try { teeth = JSON.parse(toothNumbers); } catch (e) { teeth = []; }
    } else if (Array.isArray(toothNumbers)) {
      teeth = toothNumbers;
    }
    const count = teeth.length > 0 ? teeth.length : 1;
    return basePrice * count;
  }

  return basePrice;
}

/**
 * Get required deposit amount based on user trust level.
 * Returns 0 for clean accounts.
 */
function getDepositRequired(trustLevel) {
  if (trustLevel === config.TRUST_LEVELS.STRIKE_1) return config.DEPOSIT_AMOUNTS.strike_1;
  if (trustLevel === config.TRUST_LEVELS.STRIKE_2) return config.DEPOSIT_AMOUNTS.strike_2;
  return 0;
}

/**
/**
 * Process when a case reaches READY_FOR_DISPATCH.
 * Branches on billingMode FIRST:
 *   net_30 under limit  → dispatchOnCredit() (ships now, pay at month-end)
 *   net_30 over limit   → blocked, manager must intervene
 *   prepaid (default)   → existing wallet / pay-on-go flow (unchanged)
 */
async function processReadyForDispatch(caseId) {
  const caseData = await prisma.case.findUnique({
    where: { id: caseId },
    include: { doctor: { include: { wallet: true } } },
  });

  if (!caseData) throw new Error('Case not found');

  const doctor = caseData.doctor;
  const totalAmount = caseData.totalAmountPaise || calculateOrderAmount(caseData.caseType, caseData.toothNumbers);
  const amountAfterDeposit = totalAmount - (caseData.depositPaidPaise || 0);

  // Stamp amount and readyForDispatchAt regardless of billing mode
  await prisma.case.update({
    where: { id: caseId },
    data: { totalAmountPaise: totalAmount, readyForDispatchAt: new Date(), status: 'ready_for_dispatch' },
  });

  await prisma.timeline.create({
    data: { caseId, label: 'Quality Check Passed — Ready for Dispatch' },
  });

  // ─── Net-30 credit path ────────────────────────────────────────
  if (doctor.billingMode === config.BILLING_MODES.NET_30) {
    const limit = doctor.creditLimitPaise || config.DEFAULT_CREDIT_LIMIT_PAISE;
    const newOutstanding = doctor.outstandingPaise + amountAfterDeposit;

    if (newOutstanding > limit) {
      // Over limit — block dispatch, caller should notify manager
      return {
        mode: 'credit_blocked',
        reason: 'Credit limit exceeded',
        outstanding: doctor.outstandingPaise,
        limit,
        caseAmount: amountAfterDeposit,
      };
    }

    // Under limit — dispatch on credit immediately
    return await dispatchOnCredit(caseId, caseData, doctor, amountAfterDeposit);
  }

  // ─── Prepaid path (unchanged) ──────────────────────────────────
  const wallet = doctor.wallet;
  const isWalletMode = doctor.preferredPaymentMode === 'wallet' && wallet;

  if (isWalletMode && wallet.balancePaise >= amountAfterDeposit) {
    return await autoDeductFromWallet(caseId, wallet, amountAfterDeposit, doctor.id);
  }

  if (isWalletMode && wallet.balancePaise > 0 && wallet.balancePaise < amountAfterDeposit) {
    const walletDeduct = wallet.balancePaise;
    const remainingAmount = amountAfterDeposit - walletDeduct;
    await deductFromWallet(wallet.id, walletDeduct, caseData.customId, 'Partial payment — remaining via payment link');
    const link = await generatePaymentLink(caseData, doctor, remainingAmount, walletDeduct);
    await prisma.case.update({ where: { id: caseId }, data: { status: 'payment_pending' } });
    return { mode: 'partial_wallet', walletDeducted: walletDeduct, linkAmount: remainingAmount, paymentLink: link };
  }

  const link = await generatePaymentLink(caseData, doctor, amountAfterDeposit, 0);
  await prisma.case.update({ where: { id: caseId }, data: { status: 'payment_pending' } });
  return { mode: 'pay_on_go', paymentLink: link, amount: amountAfterDeposit };
}

/**
 * Dispatch a case on credit for a net_30 clinic.
 * Status → 'dispatched' immediately. Clinic's outstanding tab increments atomically.
 */
async function dispatchOnCredit(caseId, caseData, doctor, amountPaise) {
  await prisma.$transaction(async (tx) => {
    // Credit settles the money, not the parcel — the case still has to be
    // packed and dispatched by a human.
    await tx.case.update({
      where: { id: caseId },
      data: { status: 'ready_for_dispatch', dispatchedOnCredit: true },
    });

    // Atomic increment — no read-then-write race
    await tx.user.update({
      where: { id: doctor.id },
      data: { outstandingPaise: { increment: amountPaise } },
    });

    await tx.timeline.create({
      data: {
        caseId,
        label: '🚚 Dispatched on Credit (Net-30)',
        info: `₹${config.paiseToINR(amountPaise)} added to monthly tab. Invoice generated at month-end.`,
      },
    });
  });

  return {
    mode: 'credit',
    dispatched: true,
    amountOnTab: amountPaise,
    newOutstanding: doctor.outstandingPaise + amountPaise,
  };
}


/**
 * Auto-deduct full amount from wallet and advance to dispatched.
 */
async function autoDeductFromWallet(caseId, wallet, amountPaise, userId) {
  // Atomic: all or nothing
  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balancePaise: { decrement: amountPaise },
        totalSpentPaise: { increment: amountPaise },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: config.TX_TYPES.ORDER_DEDUCT,
        amountPaise,
        direction: 'DEBIT',
        description: `Order payment — auto-deducted from wallet`,
        caseId,
      },
    });

    await tx.case.update({
      where: { id: caseId },
      data: {
        status: 'ready_for_dispatch',
        paymentConfirmedAt: new Date(),
      },
    });

    await tx.timeline.create({
      data: { caseId, label: '💳 Paid from wallet — cleared for dispatch' },
    });
  });

  // Generate GST invoice after the transaction commits
  const updatedCase = await prisma.case.findUnique({ where: { id: caseId } });
  if (updatedCase) await generateInvoice(updatedCase);

  return { mode: 'wallet_auto', deducted: amountPaise };
}

/**
 * Core wallet deduction (atomic).
 */
async function deductFromWallet(walletId, amountPaise, caseCustomId, description) {
  await prisma.wallet.update({
    where: { id: walletId },
    data: {
      balancePaise: { decrement: amountPaise },
      totalSpentPaise: { increment: amountPaise },
    },
  });
}

/**
 * Generate a Razorpay payment link for the given case.
 */
async function generatePaymentLink(caseData, doctor, amountPaise, walletDeductPaise) {
  const link = await razorpay.createPaymentLink({
    amountPaise,
    description: `Hesyra Labs — Case ${caseData.customId}`,
    customerName: doctor.name,
    customerEmail: doctor.email,
    customerPhone: '',
    referenceId: caseData.customId,
  });

  // Store payment record
  await prisma.paymentRecord.create({
    data: {
      caseId: caseData.id,
      userId: doctor.id,
      amountPaise,
      type: 'PAY_ON_GO',
      status: 'pending',
      razorpayPaymentLinkId: link.linkId,
      paymentLinkUrl: link.linkUrl,
      paymentLinkExpiry: new Date(link.expiry),
      walletDeductPaise,
    },
  });

  return link;
}

/**
 * Credit a wallet reload. Idempotent on the Razorpay payment id.
 *
 * The same reload reaches us twice by design — once from the browser
 * when Standard Checkout returns, and once from the order.paid webhook,
 * and the webhook itself is retried until it gets a 2xx. Crediting on
 * every arrival hands out free money, so the payment id is the key: if
 * a LOAD already carries it, this is a replay and nothing moves.
 */
async function creditWalletReload({ userId, amountPaise, razorpayPaymentId, description }) {
  if (!userId || !amountPaise || amountPaise <= 0) {
    return { credited: false, reason: 'Nothing to credit' };
  }

  const bonusEligible = config.WALLET_BONUS_ENABLED && amountPaise >= config.WALLET_BONUS_THRESHOLD_PAISE;
  const bonusPaise = bonusEligible ? config.WALLET_BONUS_AMOUNT_PAISE : 0;

  let wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (!wallet) wallet = await prisma.wallet.create({ data: { userId } });

  const result = await prisma.$transaction(async (tx) => {
    // The duplicate check lives inside the transaction so a concurrent
    // delivery cannot read "not credited" and then both write.
    if (razorpayPaymentId) {
      const seen = await tx.walletTransaction.findFirst({
        where: { razorpayPaymentId, type: config.TX_TYPES.LOAD },
        select: { id: true },
      });
      if (seen) return { alreadyCredited: true, credited: false };
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balancePaise: { increment: amountPaise + bonusPaise },
        totalLoadedPaise: { increment: amountPaise },
      },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: config.TX_TYPES.LOAD,
        amountPaise,
        direction: 'CREDIT',
        description: description || `Wallet reloaded — ₹${config.paiseToINR(amountPaise)}`,
        razorpayPaymentId: razorpayPaymentId || null,
      },
    });

    if (bonusPaise) {
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: config.TX_TYPES.BONUS_CREDIT,
          amountPaise: bonusPaise,
          direction: 'CREDIT',
          description: 'Bonus credit for premium reload',
        },
      });
    }

    return { credited: true, alreadyCredited: false };
  });

  if (result.alreadyCredited) return result;

  const updated = await prisma.wallet.findUnique({ where: { id: wallet.id } });
  return { ...result, loaded: amountPaise, bonus: bonusPaise, newBalance: updated.balancePaise };
}

/**
 * Handle payment confirmation (from webhook or simulation).
 * This fires for PAY_ON_GO and PARTIAL_WALLET payments.
 */
async function handlePaymentConfirmed(caseCustomId, razorpayPaymentId) {
  const caseData = await prisma.case.findUnique({
    where: { customId: caseCustomId },
    include: {
      paymentRecords: true,
      doctor: { include: { wallet: true } },
    },
  });

  if (!caseData) throw new Error('Case not found');

  // A retried webhook must not re-run any of this. Confirming twice
  // would debit a wallet twice and issue a second invoice against a
  // case that was only paid for once.
  if (caseData.paymentConfirmedAt) {
    return { success: true, alreadyConfirmed: true, status: caseData.status };
  }

  const pendingRecord = caseData.paymentRecords.find(r => r.status === 'pending' && r.type !== 'DEPOSIT');

  await prisma.$transaction(async (tx) => {
    // Mark payment record as captured
    if (pendingRecord) {
      await tx.paymentRecord.update({
        where: { id: pendingRecord.id },
        data: {
          status: 'captured',
          razorpayPaymentId: razorpayPaymentId || 'simulated',
        },
      });
    }

    // Payment clears the case for hand-over — it does not perform the
    // hand-over. The case returns to ready_for_dispatch so somebody still
    // has to pack it and enter tracking. (This used to jump straight to
    // 'shipped', which skipped packaging and tracking entirely.)
    await tx.case.update({
      where: { customId: caseCustomId },
      data: {
        status: 'ready_for_dispatch',
        paymentConfirmedAt: new Date(),
      },
    });

    await tx.timeline.create({
      data: {
        caseId: caseData.id,
        label: '💳 Payment confirmed — cleared for dispatch',
        info: razorpayPaymentId ? `Razorpay ID: ${razorpayPaymentId}` : 'Simulated payment',
      },
    });

    // ─── WALLET DEDUCTION ON PAY-ON-GO ───────────────────────────────
    // For wallet-mode cases (including simulate), the full amount must be deducted.
    // For partial-wallet cases, only the wallet portion was already deducted at
    // processReadyForDispatch time — the remainder was paid via the payment link externally.
    // For pure pay-on-go (walletDeductPaise === 0), money goes to Razorpay — no wallet touch.
    const wallet = caseData.doctor?.wallet;
    const amountPaidViawallet = pendingRecord?.walletDeductPaise || 0;
    const totalAmount = caseData.totalAmountPaise || 0;
    const depositAlreadyPaid = caseData.depositPaidPaise || 0;
    const amountDue = totalAmount - depositAlreadyPaid;

    // "Simulate" path: no payment record exists yet (case might be ready_for_dispatch
    // without a payment link). In that case, do a full wallet deduction as if wallet mode.
    const isSimulated = !razorpayPaymentId
      || razorpayPaymentId === 'simulated'
      || razorpayPaymentId.startsWith('pay_mock_'); // stub client generates these
    const isPureWalletMode = caseData.doctor?.preferredPaymentMode === 'wallet';

    // Never double-charge: if a payment record already collected this money
    // externally (pay-on-go link, or the wallet portion of a split payment),
    // the wallet must not be debited again. And never let a wallet go
    // negative — if the balance cannot cover it, the money came from the
    // payment link, not the wallet.
    const alreadyCollectedExternally = pendingRecord
      && (pendingRecord.type === 'PAY_ON_GO' || amountPaidViawallet > 0);
    const walletCanCover = wallet && wallet.balancePaise >= amountDue;

    if (isSimulated && isPureWalletMode && wallet && amountDue > 0
        && !alreadyCollectedExternally && walletCanCover) {
      // Full wallet deduction for simulate path
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balancePaise: { decrement: amountDue },
          totalSpentPaise: { increment: amountDue },
        },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: config.TX_TYPES.ORDER_DEDUCT,
          amountPaise: amountDue,
          direction: 'DEBIT',
          description: `Order payment (simulated) — Case ${caseCustomId}`,
          caseId: caseData.id,
        },
      });
    }
  });

  // Auto-generate GST invoice
  const updatedCase = await prisma.case.findUnique({ where: { customId: caseCustomId } });
  if (updatedCase) await generateInvoice(updatedCase);

  return { success: true, status: 'ready_for_dispatch' };
}

/**
 * Handle security deposit confirmation (from webhook or simulation).
 */
async function handleDepositConfirmed(caseCustomId, razorpayPaymentId) {
  const caseData = await prisma.case.findUnique({
    where: { customId: caseCustomId },
    include: { paymentRecords: true },
  });

  if (!caseData) throw new Error('Case not found');

  const pendingRecord = caseData.paymentRecords.find(r => r.status === 'pending' && r.type === 'DEPOSIT');
  if (pendingRecord) {
    await prisma.paymentRecord.update({
      where: { id: pendingRecord.id },
      data: {
        status: 'captured',
        razorpayPaymentId: razorpayPaymentId || 'simulated',
      },
    });
  }

  // Update case status to submitted since deposit cleared
  await prisma.case.update({
    where: { customId: caseCustomId },
    data: {
      status: 'submitted',
      depositPaidPaise: pendingRecord ? pendingRecord.amountPaise : 0,
    },
  });

  await prisma.timeline.create({
    data: {
      caseId: caseData.id,
      label: 'Security Deposit Confirmed',
      info: 'Order released to lab.',
    },
  });

  // Broadcast via Socket.io conceptually (will be handled by route/webhook)
  return { success: true, status: 'submitted' };
}

/**
 * Generate a GST-compliant invoice for a case.
 */
async function generateInvoice(caseData) {
  const now = new Date();

  // Sequential per-month numbering. A random suffix collides against the
  // unique constraint, and a tax invoice series has to be gap-free anyway.
  const prefix = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const issuedThisMonth = await prisma.invoice.count({
    where: { customId: { startsWith: prefix } },
  });
  const invId = `${prefix}-${String(issuedThisMonth + 1).padStart(4, '0')}`;

  // totalAmountPaise already carries the GST that was added on top of the
  // catalogue price at case creation, and it is exactly what the clinic
  // was charged. Recover the net and tax components from it so the
  // invoice total always reconciles to the amount collected.
  //
  // The rate comes from the case type — aligners are 8%, prosthetics 5%.
  // Using the default constant here would recover the wrong split on
  // every aligner invoice while still totalling correctly, which is the
  // kind of error nobody notices until a return is filed.
  const gstRate = config.gstRateFor(caseData.caseType);
  const grossPaise = caseData.totalAmountPaise || 0;
  const taxAmountPaise = Math.round(grossPaise * gstRate / (1 + gstRate));
  const netPaise = grossPaise - taxAmountPaise;

  // Resolve the real clinic name from the doctor record — the case's own
  // clinic field is client-supplied and can hold a placeholder.
  const doctor = caseData.doctorId
    ? await prisma.user.findUnique({
        where: { id: caseData.doctorId },
        select: { clinic: true, clinicState: true },
      })
    : null;

  const tax = splitTax(taxAmountPaise, doctor?.clinicState);

  const created = await prisma.invoice.create({
    data: {
      customId: invId,
      // Taxable value, in rupees. Add taxAmountPaise for the gross.
      amount: netPaise / 100,
      status: 'paid',
      paidAt: caseData.paymentConfirmedAt || now,
      clinic: doctor?.clinic || caseData.clinic,
      userId: caseData.doctorId || null,
      invoiceType: 'per_case',
      gstRate,
      hsnCode: config.HSN_CODE,
      gstin: config.HESYRA_GSTIN,
      taxAmountPaise,
      ...tax,
      cases: { connect: { id: caseData.id } },
    },
  });

  // Email it. Deliberately not awaited into the caller's success:
  // sendInvoice() never throws, and a bounced email must not undo an
  // invoice that legitimately exists and is already on the dashboard.
  deliverInvoice(created.customId);

  return created;
}

/**
 * Fire-and-forget invoice delivery.
 *
 * Isolated here so both invoice paths use it and neither can be made to
 * fail by a mail problem. Failures are logged, and the invoice remains
 * downloadable in-app regardless — which is why not being able to send
 * is an inconvenience rather than a lost document.
 */
function deliverInvoice(invoiceCustomId) {
  // Required lazily: invoiceMailer pulls in the PDF renderer, and this
  // module is loaded by routes that never issue an invoice.
  const invoiceMailer = require('./invoiceMailer');

  invoiceMailer.sendInvoice(invoiceCustomId)
    .then(r => {
      if (r.sent) console.log(`  [Invoice] ${invoiceCustomId} emailed to ${r.to}`);
      else console.warn(`  [Invoice] ${invoiceCustomId} not emailed — ${r.reason}`);
    })
    .catch(err => console.warn(`  [Invoice] ${invoiceCustomId} delivery error:`, err.message));
}

/**
 * Split a tax amount into CGST/SGST or IGST for a clinic in a given
 * state, in the shape the Invoice row stores.
 *
 * Halving is done on the paise rather than deriving each half from the
 * rate, so the two always re-add to the total instead of leaving a
 * one-paise hole on odd amounts.
 */
function splitTax(taxAmountPaise, clinicState) {
  const treatment = razorpay.resolveTaxTreatment(clinicState);
  const half = Math.floor(taxAmountPaise / 2);

  return {
    placeOfSupply: treatment.placeOfSupply,
    placeOfSupplyAssumed: treatment.assumed,
    interState: treatment.interState,
    cgstPaise: treatment.interState ? 0 : half,
    sgstPaise: treatment.interState ? 0 : taxAmountPaise - half,
    igstPaise: treatment.interState ? taxAmountPaise : 0,
  };
}

/**
 * Generate a consolidated monthly invoice for a single net_30 clinic.
 * Bundles all cases dispatched on credit that haven't been invoiced yet.
 * Returns null if the clinic has no uninvoiced credit cases this period.
 */
async function generateMonthlyInvoice(userId, billingPeriod) {
  // Find all credit cases for this clinic that haven't been assigned to an invoice yet
  const creditCases = await prisma.case.findMany({
    where: {
      doctorId: userId,
      dispatchedOnCredit: true,
      creditInvoiceId: null,             // Not yet invoiced
      status: { notIn: ['cancelled'] },  // Ignore cancelled cases
    },
    include: { doctor: { select: { name: true, clinic: true, email: true, clinicState: true } } },
  });

  if (creditCases.length === 0) return null;

  const doctor = creditCases[0].doctor;
  const totalPaise = creditCases.reduce((sum, c) => sum + (c.totalAmountPaise || 0), 0);
  const totalINR = totalPaise / 100;

  // totalAmountPaise is GST-INCLUSIVE — the tax was added on top at
  // case creation and is already inside this figure. Recover it the
  // same way per-case invoices do.
  //
  // This previously read `totalINR * GST_RATE * 100`, which applies the
  // rate a second time to a gross amount and overstates the tax on
  // every monthly invoice by about 5% of itself.
  //
  // A month's cases can carry different rates — an aligner at 8% beside
  // crowns at 5% — so the tax is recovered case by case and summed. One
  // rate applied to the bundle would be wrong for every clinic that
  // ordered both in the same month.
  const taxAmount = creditCases.reduce((sum, c) => {
    const rate = config.gstRateFor(c.caseType);
    return sum + Math.round((c.totalAmountPaise || 0) * rate / (1 + rate));
  }, 0);

  // A single gstRate only describes the invoice when every case on it
  // shares one. Where they differ it is left null rather than stating a
  // rate that applies to only part of the document — the per-line rates
  // on the rendered invoice carry the detail.
  const rates = [...new Set(creditCases.map(c => config.gstRateFor(c.caseType)))];
  const uniformRate = rates.length === 1 ? rates[0] : null;

  const now = new Date();
  const dueDate = new Date(now.getTime() + config.CREDIT_PAYMENT_DAYS * 24 * 60 * 60 * 1000);

  // Build a unique invoice ID: MINV-YYYYMM-XXXX
  const invId = `MINV-${billingPeriod.replace('-', '')}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Generate a Razorpay payment link for the full outstanding amount
  let paymentLink = null;
  try {
    paymentLink = await razorpay.createPaymentLink({
      amountPaise: totalPaise,
      description: `Hesyra Labs — Monthly Invoice ${billingPeriod}`,
      customerName: doctor.name,
      customerEmail: doctor.email,
      referenceId: invId,
    });
  } catch (e) {
    console.warn('[CreditEngine] Razorpay link failed — invoice created without link:', e.message);
  }

  const invoice = await prisma.$transaction(async (tx) => {
    // Create the consolidated invoice
    const inv = await tx.invoice.create({
      data: {
        customId: invId,
        amount: totalINR,
        status: 'unpaid',
        clinic: doctor.clinic || doctor.name,
        invoiceType: 'monthly',
        billingPeriod,
        dueDate,
        gstRate: uniformRate,
        hsnCode: config.HSN_CODE,
        gstin: config.HESYRA_GSTIN,
        taxAmountPaise: taxAmount,
        ...splitTax(taxAmount, doctor.clinicState),
        userId,
        cases: { connect: creditCases.map(c => ({ id: c.id })) },
      },
    });

    // Stamp each case with the invoice ID so we don't double-bill
    await tx.case.updateMany({
      where: { id: { in: creditCases.map(c => c.id) } },
      data: { creditInvoiceId: inv.id },
    });

    return inv;
  });

  console.log(`  [CreditEngine] ✅ Monthly invoice ${invId} generated for ${doctor.name}: ₹${totalINR} (${creditCases.length} cases)`);

  // A month-end invoice with a due date is the one that most needs to
  // arrive by email — nobody checks a dashboard for a bill they do not
  // know exists.
  deliverInvoice(invId);

  return { invoice, caseCount: creditCases.length, totalPaise, paymentLink };
}

/**
 * Handle payment of a monthly credit invoice.
 * Clears the invoice, decrements clinic's outstanding tab, marks cases as paid.
 */
async function handleCreditPayment(invoiceId, razorpayPaymentId) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      cases: { select: { id: true, customId: true } },
      user: true,
    },
  });

  if (!invoice) throw new Error('Invoice not found');
  if (invoice.status === 'paid') return { alreadyPaid: true };

  const amountPaise = Math.round(invoice.amount * 100);

  await prisma.$transaction(async (tx) => {
    // Mark the invoice as paid
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'paid', paidAt: new Date() },
    });

    // Mark all cases in this invoice as payment confirmed
    const caseIds = invoice.cases.map(c => c.id);
    await tx.case.updateMany({
      where: { id: { in: caseIds } },
      data: { paymentConfirmedAt: new Date() },
    });

    // Atomically decrement the clinic's outstanding tab
    if (invoice.userId) {
      await tx.user.update({
        where: { id: invoice.userId },
        data: { outstandingPaise: { decrement: amountPaise } },
      });
    }

    // Timeline entries on each case
    const timelineEntries = invoice.cases.map(c => ({
      caseId: c.id,
      label: `✅ Monthly Invoice Paid`,
      info: `Invoice ${invoice.customId} settled. ${razorpayPaymentId ? `Razorpay: ${razorpayPaymentId}` : 'Simulated'}`,
    }));
    await tx.timeline.createMany({ data: timelineEntries });
  });

  // Clamp outstanding to 0 if it went negative (edge case)
  if (invoice.userId) {
    await prisma.user.updateMany({
      where: { id: invoice.userId, outstandingPaise: { lt: 0 } },
      data: { outstandingPaise: 0 },
    });
  }

  console.log(`  [CreditEngine] ✅ Invoice ${invoice.customId} paid. ${invoice.cases.length} cases settled.`);
  return { success: true, invoiceId: invoice.customId, amountPaise };
}

/**
 * Apply a strike to a user's account. Idempotent — won't double-strike for same case.
 */
async function applyStrike(userId, caseId) {
  // Check if already struck for this case
  const existing = await prisma.strike.findUnique({
    where: { userId_caseId: { userId, caseId } },
  });
  if (existing) return { alreadyApplied: true, strike: existing };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

  const newStrikeCount = user.strikeCount + 1;
  let newTrustLevel = config.TRUST_LEVELS.CLEAN;
  if (newStrikeCount >= 3) newTrustLevel = config.TRUST_LEVELS.SUSPENDED;
  else if (newStrikeCount >= 2) newTrustLevel = config.TRUST_LEVELS.STRIKE_2;
  else if (newStrikeCount >= 1) newTrustLevel = config.TRUST_LEVELS.STRIKE_1;

  // Create strike record
  const strike = await prisma.strike.create({
    data: {
      userId,
      caseId,
      strikeNumber: newStrikeCount,
    },
  });

  // Update user
  const updateData = {
    strikeCount: newStrikeCount,
    trustLevel: newTrustLevel,
  };
  if (newTrustLevel === config.TRUST_LEVELS.SUSPENDED) {
    updateData.status = 'suspended';
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  // Update case status to overdue
  await prisma.case.update({
    where: { id: caseId },
    data: { status: 'overdue' },
  });

  // Timeline
  await prisma.timeline.create({
    data: {
      caseId,
      label: `Strike ${newStrikeCount} Applied — ${newStrikeCount >= 3 ? 'Account Suspended' : 'Payment Overdue'}`,
    },
  });

  return { alreadyApplied: false, strike, newStrikeCount, newTrustLevel };
}

/**
 * Collect deposit at order placement for Strike 1/2 accounts.
 * Checks wallet first, then requires upfront payment.
 */
async function collectDeposit(userId, caseId, depositPaise) {
  const wallet = await prisma.wallet.findUnique({ where: { userId } });

  if (wallet && wallet.balancePaise >= depositPaise) {
    // Auto-deduct deposit from wallet
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balancePaise: { decrement: depositPaise },
        totalSpentPaise: { increment: depositPaise },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: config.TX_TYPES.DEPOSIT_DEDUCT,
        amountPaise: depositPaise,
        direction: 'DEBIT',
        description: `Order deposit — deducted from wallet`,
        caseId,
      },
    });

    await prisma.case.update({
      where: { id: caseId },
      data: { depositPaidPaise: depositPaise },
    });

    return { source: 'wallet', collected: true };
  }

  // Need Razorpay payment for deposit
  const link = await razorpay.createPaymentLink({
    amountPaise: depositPaise,
    description: `Hesyra Labs — Order Deposit`,
    customerName: '',
    customerEmail: '',
    referenceId: `deposit-${caseId}`,
  });

  await prisma.paymentRecord.create({
    data: {
      caseId,
      userId,
      amountPaise: depositPaise,
      type: 'DEPOSIT',
      status: 'pending',
      razorpayPaymentLinkId: link.linkId,
      paymentLinkUrl: link.linkUrl,
      paymentLinkExpiry: new Date(link.expiry),
    },
  });

  return { source: 'razorpay_link', collected: false, paymentLink: link };
}

/**
 * Issue a complete refund returning floating balance to the user's wallet
 * instead of direct-to-bank to maintain system liquidity.
 */
async function issueRefund(caseId, reason) {
  const caseData = await prisma.case.findUnique({ where: { id: caseId } });
  if (!caseData) throw new Error('Case not found');

  // Only refund what was actually paid:
  // - If payment was confirmed (shipped), refund totalAmount minus any deposit already accounted for
  // - If only deposit was paid (case was in draft/submitted/designing), refund only the deposit
  let amountToRefund = 0;
  if (caseData.paymentConfirmedAt) {
    // Full payment was made — refund total
    amountToRefund = caseData.totalAmountPaise || 0;
  } else if (caseData.depositPaidPaise > 0) {
    // Only deposit was paid, full payment never happened
    amountToRefund = caseData.depositPaidPaise;
  }
  
  if (amountToRefund <= 0) return { refunded: false, reason: 'No funds to refund' };

  const wallet = await prisma.wallet.findUnique({ where: { userId: caseData.doctorId } });
  if (!wallet) throw new Error('Wallet not found');

  await prisma.$transaction(async (tx) => {
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balancePaise: { increment: amountToRefund } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: config.TX_TYPES.REFUND,
        amountPaise: amountToRefund,
        direction: 'CREDIT',
        description: `Refund for Cancelled/Rejected Case — ${reason || 'User requested'}`,
        caseId,
      },
    });

    await tx.timeline.create({
      data: {
        caseId: caseData.id,
        label: 'Funds Refunded to Wallet',
        info: `₹${(amountToRefund / 100).toFixed(2)} credited back.`,
      },
    });
  });

  return { refunded: true, amountPaise: amountToRefund };
}

module.exports = {
  calculateOrderAmount,
  getDepositRequired,
  processReadyForDispatch,
  handlePaymentConfirmed,
  handleDepositConfirmed,
  creditWalletReload,
  deliverInvoice,
  applyStrike,
  collectDeposit,
  generateInvoice,
  generateMonthlyInvoice,
  handleCreditPayment,
  autoDeductFromWallet,
  issueRefund,
};

