import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { casesAPI, invoicesAPI } from '../utils/api';
import { useToasts } from './ToastContext';

const CaseContext = createContext(null);

// ═══════════════════════════════════════════════════════════════════
// PRICING TABLE — single source of truth
// ═══════════════════════════════════════════════════════════════════
const CASE_PRICING = {
  crown_bridge: 1500, surgical_guide: 3000, splint: 1800,
  retainer: 1200, aligner: 2500, denture: 4500, veneer: 2000,
  model: 400, default: 1000,
};

// ═══════════════════════════════════════════════════════════════════
// STATE MACHINE — client-side reference (server is authoritative)
// This MUST match VALID_TRANSITIONS in server/routes/cases.js
// ═══════════════════════════════════════════════════════════════════
const VALID_TRANSITIONS = {
  // Entry
  draft:               ['submitted', 'cancelled'],
  submitted:           ['cad_assigned', 'action_required', 'cancelled'],
  action_required:     ['submitted', 'cancelled'],
  // CAD workflow
  cad_assigned:        ['design_ready', 'blocked', 'cancelled'],
  blocked:             ['cad_assigned', 'cancelled'],
  design_ready:        ['design_approved', 'design_revision', 'cancelled'],
  design_revision:     ['design_ready', 'cancelled'],
  design_approved:     ['batched', 'post_processing', 'cancelled'],
  // Batch production
  batched:             ['printing', 'design_approved', 'cancelled'],
  printing:            ['printed', 'qa', 'post_processing', 'cancelled'],
  printed:             ['finishing', 'cancelled'],
  finishing:           ['qa', 'cancelled'],
  // Legacy production (technician)
  post_processing:     ['qa', 'cad_assigned', 'cancelled'],
  qa:                  ['ready_for_dispatch', 'post_processing', 'cancelled'],
  // Dispatch & payment
  ready_for_dispatch:  ['packaged', 'payment_pending', 'cancelled'],
  payment_pending:     ['packaged', 'overdue', 'cancelled'],
  overdue:             ['packaged', 'payment_pending', 'cancelled'],
  packaged:            ['dispatched', 'cancelled'],
  dispatched:          ['completed', 'archived'],
  // End states
  completed:           ['archived'],
  archived:            [],
  cancelled:           [],
  // Legacy status keys (backwards compat with old seed data in DB)
  designing:           ['design_ready', 'blocked', 'action_required', 'cancelled'],
  pending_approval:    ['design_approved', 'design_revision', 'cancelled'],
  printing:            ['qa', 'post_processing', 'action_required', 'cancelled'],
  shipped:             ['completed', 'archived'],
};

const STATUS_LABELS = {
  draft:               'Draft',
  submitted:           'Submitted',
  action_required:     'Action Required',
  cad_assigned:        'CAD Assigned',
  blocked:             'Blocked — Scan Issue',
  design_ready:        'Design Ready for Review',
  design_revision:     'Revision Requested',
  design_approved:     'Design Approved',
  // Batch production
  batched:             'Batched — Awaiting Print',
  printing:            'Printing (Batch)',
  printed:             'Printed — Awaiting Ceramist',
  finishing:           'Ceramist Finishing',
  // Legacy production
  post_processing:     'Post-Processing',
  qa:                  'Quality Check',
  ready_for_dispatch:  'Ready for Dispatch',
  payment_pending:     'Payment Pending',
  packaged:            'Packaged',
  dispatched:          'Dispatched',
  overdue:             'Overdue',
  completed:           'Delivered',
  archived:            'Archived',
  cancelled:           'Cancelled',
  // Legacy
  designing:           'Designing (CAD)',
  pending_approval:    'Pending Approval',
  printing:            'Printing / Post-Process',
  shipped:             'Shipped',
};

// ═══════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════
export const CaseProvider = ({ children }) => {
  const { addToast } = useToasts();
  const [cases, setCases] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const casesRef = useRef(cases);
  casesRef.current = cases;

  // ─── Fetch data from API on mount ──────────────────────────
  const refreshCases = useCallback(async () => {
    try {
      const data = await casesAPI.list();
      setCases(data);
    } catch (err) {
      console.error('Failed to fetch cases:', err);
    }
  }, []);

  const refreshInvoices = useCallback(async () => {
    try {
      const data = await invoicesAPI.list();
      setInvoices(data);
    } catch (err) {
      console.error('Failed to fetch invoices:', err);
    }
  }, []);

  useEffect(() => {
    Promise.all([refreshCases(), refreshInvoices()])
      .finally(() => setLoading(false));
  }, [refreshCases, refreshInvoices]);

  // ─── Socket.io real-time updates ───────────────────────────
  useEffect(() => {
    // Dynamic import to avoid issues when socket.io-client isn't loaded
    let socket = null;
    try {
      const io = window.__hesyraSocket;
      if (io) {
        socket = io;
        socket.on('case:created', (data) => { 
          refreshCases(); 
          addToast(data?.customId ? `New case received: ${data.customId}` : 'New case received!', 'info'); 
        });
        socket.on('case:updated', (data) => { 
          refreshCases();
          if (data && data.customId && data.newStatus) {
            addToast(`Case ${data.customId} is now ${STATUS_LABELS[data.newStatus] || data.newStatus}`, 'info');
          }
        });
        socket.on('case:deleted', () => { refreshCases(); });
        socket.on('case:message', (data) => { 
          refreshCases(); 
          addToast(data?.customId ? `New message in case ${data.customId}` : 'New message in case chat', 'info'); 
        });
        socket.on('invoice:created', () => refreshInvoices());
        socket.on('invoice:updated', () => refreshInvoices());
        socket.on('invoice:deleted', () => refreshInvoices());
        socket.on('payment:confirmed', (data) => {
          refreshCases();
          refreshInvoices();
          addToast(data?.caseId ? `Payment confirmed for ${data.caseId}` : 'Payment confirmed!', 'success');
        });
      }
    } catch { /* socket not available */ }

    return () => {
      if (socket) {
        socket.off('case:created');
        socket.off('case:updated');
        socket.off('case:deleted');
        socket.off('case:message');
        socket.off('invoice:created');
        socket.off('invoice:updated');
        socket.off('invoice:deleted');
        socket.off('payment:confirmed');
      }
    };
  }, [refreshCases, refreshInvoices, addToast]);

  // ─── Validate Transition (client-side preview) ─────────────
  const isValidTransition = useCallback((fromStatus, toStatus) => {
    const allowed = VALID_TRANSITIONS[fromStatus];
    return allowed && allowed.includes(toStatus);
  }, []);

  const getCurrentStatus = useCallback((id) => {
    const c = casesRef.current.find(x => x.id === id);
    return c ? c.status : null;
  }, []);

  // ─── Core Status Transition Engine ─────────────────────────
  const transitionCaseStatus = useCallback(async (id, newStatus, opts = {}) => {
    const { timelineLabel, timelineInfo, clearRejection, rejectionReason, tracking, force } = opts;

    try {
      const result = await casesAPI.updateStatus(id, {
        newStatus, timelineLabel, timelineInfo, rejectionReason, tracking, force,
      });

      if (result.success) {
        // Optimistic update
        const finalStatus = result.finalStatus || newStatus;
        setCases(prev => prev.map(c => {
          if (c.id !== id) return c;
          const updated = { ...c, status: finalStatus };
          if (rejectionReason) updated.rejectionReason = rejectionReason;
          if (clearRejection) updated.rejectionReason = null;
          if (tracking) updated.tracking = tracking;
          return updated;
        }));

        addToast(`Status updated to ${STATUS_LABELS[finalStatus]}`, 'success');
        
        // Full refresh to get timeline updates
        refreshCases();
        if (newStatus === 'shipped') refreshInvoices();
        return true;
      }
      return false;
    } catch (err) {
      const errMsg = err?.message || 'Status transition failed';
      addToast(errMsg, 'error');
      console.error('Status transition failed:', err);
      return false;
    }
  }, [refreshCases, refreshInvoices, addToast]);

  // ─── Add Case ──────────────────────────────────────────────
  const addCase = useCallback(async (formData, isDraft = false, user = null) => {
    try {
      const result = await casesAPI.create({
        patientName: formData.patientName,
        caseType: formData.caseType,
        type: formData.type || null,
        material: formData.material,
        shade: formData.shade,
        toothNumbers: formData.toothNumbers,
        archTarget: formData.archTarget,
        implantSystem: formData.implantSystem,
        instructions: formData.instructions,
        isDraft,
        clinic: user?.clinic,
        doctorId: user?.id,
        // SKU Catalog fields
        materialSkuId: formData.materialSkuId || null,
        finishingTier: formData.finishingTier || 'standard',
        specificType: formData.specificType || null,
        // Note: files are uploaded separately via multipart POST /:customId/upload
      });

      if (result.success) {
        addToast(isDraft ? 'Draft saved' : 'Prescription submitted successfully', 'success');
        refreshCases();
        return result; // Returning the full result to handle deposit logic in NewCase
      }
      return null;
    } catch (err) {
      if (err.message && err.message.includes('suspended')) {
        addToast('Account suspended. Please submit a resolution ticket.', 'error');
        // The App routing will auto-redirect if they are suspended
      } else {
        addToast(err.message || 'Failed to create case', 'error');
      }
      console.error('Add case failed:', err);
      return null;
    }
  }, [refreshCases, addToast]);

  const getCaseById = useCallback((id) => {
    return casesRef.current.find(c => c.id === id);
  }, []); // casesRef.current always reflects latest state, no dep needed

  // ─── Status Update (uses state machine) ────────────────────
  const updateCaseStatus = useCallback((id, newStatus) => {
    return transitionCaseStatus(id, newStatus, { force: true });
  }, [transitionCaseStatus]);

  const updateCaseData = useCallback(async (id, newData) => {
    try {
      await casesAPI.update(id, newData);
      setCases(prev => prev.map(c => c.id === id ? { ...c, ...newData } : c));
      refreshCases();
    } catch (err) {
      console.error('Update case failed:', err);
    }
  }, [refreshCases]);

  // ─── Messaging ────────────────────────────────────────────
  const addMessage = useCallback(async (caseId, from, text) => {
    try {
      await casesAPI.addMessage(caseId, text, from);
      // Optimistic update
      const timeStr = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      setCases(prev => prev.map(c =>
        c.id === caseId
          ? { ...c, messages: [...c.messages, { from, text, time: timeStr }] }
          : c
      ));
    } catch (err) {
      console.error('Add message failed:', err);
    }
  }, []);

  // ─── Assignment ───────────────────────────────────────────
  const assignCase = useCallback(async (id, techName) => {
    try {
      await casesAPI.update(id, { tech: techName });
      setCases(prev => prev.map(c =>
        c.id === id ? { ...c, tech: techName } : c
      ));
      refreshCases();
    } catch (err) {
      console.error('Assign case failed:', err);
    }
  }, [refreshCases]);

  // ─── Reject Case (Tech → Dentist) ────────────────────────
  const rejectCase = useCallback((id, reason) => {
    return transitionCaseStatus(id, 'action_required', {
      timelineLabel: 'Sent Back for Review',
      timelineInfo: reason,
      rejectionReason: reason,
    });
  }, [transitionCaseStatus]);

  // ─── Accept & Start CAD Work ────────────────────────────────
  const acceptCase = useCallback(async (id, techName) => {
    if (techName) await assignCase(id, techName);
    return transitionCaseStatus(id, 'cad_assigned', {
      timelineLabel: 'Accepted — CAD Work Assigned',
    });
  }, [transitionCaseStatus, assignCase]);

  // ─── Designer submits, manager reviews — no doctor-direct approval
  // sendForApproval is replaced by the designer's /submit endpoint.
  // Kept as a no-op shim so existing TechWorkspace references don't crash.
  const sendForApproval = useCallback((id) => {
    console.warn('sendForApproval is deprecated. Designer submits via /api/designer/cases/:id/submit.');
    return Promise.resolve(false);
  }, []);

  // ─── Technician: Start Post-Processing ───────────────────────
  const startPostProcessing = useCallback((id) => {
    return transitionCaseStatus(id, 'post_processing', {
      timelineLabel: 'Post-processing started (printing / milling)',
    });
  }, [transitionCaseStatus]);

  // ─── Technician: Send to QA ───────────────────────────────────
  const sendToQA = useCallback((id) => {
    return transitionCaseStatus(id, 'qa', {
      timelineLabel: 'Sent to Quality Check',
    });
  }, [transitionCaseStatus]);

  // ─── Doctor Approves Design ───────────────────────────────
  const approveDesign = useCallback((id) => {
    return transitionCaseStatus(id, 'printing', {
      timelineLabel: 'Doctor Approved — Printing Started',
      clearRejection: true,
    });
  }, [transitionCaseStatus]);

  // ─── Doctor Requests Changes ──────────────────────────────
  const requestDesignChanges = useCallback((id, reason) => {
    return transitionCaseStatus(id, 'designing', {
      timelineLabel: 'Doctor Requested Design Changes',
      timelineInfo: reason,
      rejectionReason: reason,
    });
  }, [transitionCaseStatus]);

  // ─── Send to Printer / Post-Processing ───────────────────────
  const sendToPrinter = useCallback((id) => {
    return transitionCaseStatus(id, 'post_processing', {
      timelineLabel: 'Sent to Printer / Post-Processing',
    });
  }, [transitionCaseStatus]);

  // ─── QC Pass → Ready for Dispatch ────────────────────────────
  const readyForDispatch = useCallback((id) => {
    return transitionCaseStatus(id, 'ready_for_dispatch', {
      timelineLabel: 'QC Passed — Ready for Dispatch',
    });
  }, [transitionCaseStatus]);

  // ─── QC Fail → back to post-processing ───────────────────────
  const qcRemake = useCallback((id) => {
    return transitionCaseStatus(id, 'post_processing', {
      timelineLabel: 'QC Failed — Returned to Post-Processing',
    });
  }, [transitionCaseStatus]);

  // ─── Ship / Dispatch Case ────────────────────────────────────
  const shipCase = useCallback(async (id, trackingData) => {
    const targetCase = casesRef.current.find(c => c.id === id);
    if (!targetCase || targetCase.status === 'dispatched') return false;

    const courierLabel = trackingData?.courier || 'Courier';
    return transitionCaseStatus(id, 'dispatched', {
      timelineLabel: `Dispatched via ${courierLabel}`,
      timelineInfo: `Tracking: ${trackingData?.number || 'N/A'}`,
      tracking: trackingData,
    });
  }, [transitionCaseStatus]);

  // ─── Mark as Completed ────────────────────────────────────
  const markCompleted = useCallback((id) => {
    return transitionCaseStatus(id, 'completed', {
      timelineLabel: 'Case Completed — Delivery Confirmed',
    });
  }, [transitionCaseStatus]);

  // ─── Resubmit After Action Required ───────────────────────
  const resubmitCase = useCallback((id) => {
    return transitionCaseStatus(id, 'submitted', {
      timelineLabel: 'Resubmitted After Corrections',
      clearRejection: true,
    });
  }, [transitionCaseStatus]);

  // ─── Admin-level functions ────────────────────────────────
  const deleteCase = useCallback(async (id) => {
    try {
      await casesAPI.delete(id);
      setCases(prev => prev.filter(c => c.id !== id));
    } catch (err) {
      console.error('Delete case failed:', err);
    }
  }, []);

  const markInvoicePaid = useCallback(async (invoiceId) => {
    try {
      const result = await invoicesAPI.togglePaid(invoiceId);
      if (result.success) {
        setInvoices(prev => prev.map(inv =>
          inv.id === invoiceId ? { ...inv, status: result.status } : inv
        ));
      }
    } catch (err) {
      console.error('Toggle invoice failed:', err);
    }
  }, []);

  const deleteInvoice = useCallback(async (invoiceId) => {
    try {
      await invoicesAPI.delete(invoiceId);
      setInvoices(prev => prev.filter(inv => inv.id !== invoiceId));
    } catch (err) {
      console.error('Delete invoice failed:', err);
    }
  }, []);

  // ─── Analytics helpers ────────────────────────────────────
  const getRevenueByClinic = useCallback(() => {
    const map = {};
    invoices.filter(i => i.status === 'paid').forEach(i => {
      const clinic = i.clinic || 'Unknown';
      map[clinic] = (map[clinic] || 0) + i.amount;
    });
    return Object.entries(map).map(([clinic, amount]) => ({ clinic, amount }));
  }, [invoices]);

  const getCasesByStatus = useCallback(() => {
    const map = {};
    cases.forEach(c => { map[c.status] = (map[c.status] || 0) + 1; });
    return Object.entries(map).map(([status, count]) => ({ status, count }));
  }, [cases]);

  const getCasesByClinic = useCallback(() => {
    const map = {};
    cases.forEach(c => {
      const clinic = c.clinic || 'Unknown';
      map[clinic] = (map[clinic] || 0) + 1;
    });
    return Object.entries(map).map(([clinic, count]) => ({ clinic, count }));
  }, [cases]);

  // ─── File Upload ──────────────────────────────────────────────
  const uploadDesignFile = useCallback(async (caseId, files, category = 'design') => {
    try {
      const result = await casesAPI.uploadFile(caseId, files, category);
      if (result.success) {
        addToast(`${files.length} file(s) uploaded successfully`, 'success');
        refreshCases();
        return result.files;
      }
      return null;
    } catch (err) {
      addToast(err.message || 'File upload failed', 'error');
      console.error('Upload failed:', err);
      return null;
    }
  }, [refreshCases, addToast]);

  const deleteDesignFile = useCallback(async (caseId, fileId) => {
    try {
      await casesAPI.deleteFile(caseId, fileId);
      addToast('File removed', 'info');
      refreshCases();
      return true;
    } catch (err) {
      addToast('Failed to delete file', 'error');
      return false;
    }
  }, [refreshCases, addToast]);

  return (
    <CaseContext.Provider value={{
      cases, invoices, loading, addCase, getCaseById, updateCaseStatus, updateCaseData, addMessage,
      assignCase, rejectCase, acceptCase, shipCase, approveDesign, requestDesignChanges,
      sendForApproval, sendToPrinter, startPostProcessing, sendToQA, qcRemake, readyForDispatch,
      markCompleted, resubmitCase, deleteCase, markInvoicePaid, deleteInvoice,
      uploadDesignFile, deleteDesignFile,
      getRevenueByClinic, getCasesByStatus, getCasesByClinic,
      CASE_PRICING, STATUS_LABELS, VALID_TRANSITIONS,
      transitionCaseStatus, isValidTransition, getCurrentStatus,
      refreshCases, refreshInvoices,
    }}>
      {children}
    </CaseContext.Provider>
  );
};

export const useCases = () => useContext(CaseContext);

