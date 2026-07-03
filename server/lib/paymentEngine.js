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
    await tx.case.update({
      where: { id: caseId },
      data: { status: 'dispatched', dispatchedOnCredit: true, dispatchedAt: new Date() },
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
        status: 'shipped',
        paymentConfirmedAt: new Date(),
      },
    });

    await tx.timeline.create({
      data: { caseId, label: 'Payment Auto-Deducted from Wallet — Dispatched' },
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

    // Update case to shipped
    await tx.case.update({
      where: { customId: caseCustomId },
      data: {
        status: 'shipped',
        paymentConfirmedAt: new Date(),
      },
    });

    await tx.timeline.create({
      data: {
        caseId: caseData.id,
        label: 'Payment Confirmed — Order Dispatched',
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

    if (isSimulated && isPureWalletMode && wallet && amountDue > 0) {
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

  return { success: true, status: 'shipped' };
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
  const invId = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}${Math.floor(100 + Math.random() * 900)}`;
  const amountINR = (caseData.totalAmountPaise || 0) / 100;
  const taxAmount = Math.round(amountINR * config.GST_RATE * 100);

  await prisma.invoice.create({
    data: {
      customId: invId,
      amount: amountINR,
      status: 'paid',
      clinic: caseData.clinic,
      invoiceType: 'per_case',
      gstRate: config.GST_RATE,
      hsnCode: config.HSN_CODE,
      gstin: config.HESYRA_GSTIN,
      taxAmountPaise: taxAmount,
      cases: { connect: { id: caseData.id } },
    },
  });
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
    include: { doctor: { select: { name: true, clinic: true, email: true } } },
  });

  if (creditCases.length === 0) return null;

  const doctor = creditCases[0].doctor;
  const totalPaise = creditCases.reduce((sum, c) => sum + (c.totalAmountPaise || 0), 0);
  const totalINR = totalPaise / 100;
  const taxAmount = Math.round(totalINR * config.GST_RATE * 100);
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
        gstRate: config.GST_RATE,
        hsnCode: config.HSN_CODE,
        gstin: config.HESYRA_GSTIN,
        taxAmountPaise: taxAmount,
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
  applyStrike,
  collectDeposit,
  generateInvoice,
  generateMonthlyInvoice,
  handleCreditPayment,
  autoDeductFromWallet,
  issueRefund,
};

