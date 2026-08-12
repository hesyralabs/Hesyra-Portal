import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UploadCloud, FileType, CheckCircle2, ChevronLeft, Layers,
  AlertTriangle, Clock, Check } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { useOnboarding } from '../../context/OnboardingContext';
import DragDropZone from '../../components/UI/DragDropZone';
import CoachTour from '../../components/Onboarding/CoachTour';
import styles from './NewCase.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Grouped the way the price list is: prosthetics, orthodontics,
// surgical, paediatric. `turnaround` is the working-day promise shown
// before a doctor commits to a category.
const CASE_TYPES = [
  { id: 'crown_bridge',   group: 'Prosthetics',   name: 'Crowns & Bridges',    desc: 'Single units, multi-unit bridges & temporaries',  turnaround: '3–4 days' },
  { id: 'veneer',         group: 'Prosthetics',   name: 'Veneers',             desc: 'Layered & pressed ceramic laminates',             turnaround: '4–5 days' },
  { id: 'inlay_onlay',    group: 'Prosthetics',   name: 'Inlays & Onlays',     desc: 'Precision-fit intracoronal & cuspal coverage',    turnaround: '3–4 days' },
  { id: 'denture',        group: 'Prosthetics',   name: 'Dentures',            desc: 'Complete, partial & implant overdentures',        turnaround: '7–9 days' },

  { id: 'aligner',        group: 'Orthodontics',  name: 'Clear Aligners',      desc: 'Shape-memory sequential aligner therapy',         turnaround: '7–10 days' },
  { id: 'retainer',       group: 'Orthodontics',  name: 'Retainers',           desc: 'Essix, Hawley & fixed lingual retention',         turnaround: '2–3 days' },
  { id: 'splint',         group: 'Orthodontics',  name: 'Splints & Nightguards', desc: 'Occlusal guards, bruxism & TMJ splints',        turnaround: '2–3 days' },

  { id: 'surgical_guide', group: 'Surgical',      name: 'Surgical Guides',     desc: 'Implant planning & pilot / full-guided drill',    turnaround: '3–4 days' },

  { id: 'space_maintainer',     group: 'Paediatric', name: 'Space Maintainers',     desc: 'Metal-free, band-and-loop-free — both arches', turnaround: '3–4 days' },
  { id: 'pediatric_aligner',    group: 'Paediatric', name: 'Pediatric Aligners',    desc: 'Arch development & deep-bite correction',      turnaround: 'Quoted' },
  { id: 'posterior_bite_block', group: 'Paediatric', name: 'Posterior Bite Blocks', desc: 'Printed bite-raising appliance',               turnaround: 'Quoted' },
];

const CASE_GROUPS = ['Prosthetics', 'Orthodontics', 'Surgical', 'Paediatric'];

// ─── What the lab actually needs on the bench ──────────────────
// A scan is per arch, not per file, so uploads are asked for by role.
// The old step 3 was one unlabelled drop zone: a doctor could attach a
// single upper-arch STL, see a green tick and "1 file attached", and
// submit a case the lab could not start.
//
// Files carry their role as a `Role__` filename prefix, which is the
// convention already used on this step, and it means the technician
// opening the case sees `Upper__scan.stl` rather than `export(3).stl`.
const SCAN_ROLE_SEP = '__';

const SCAN_SLOTS = {
  surgical_guide: [
    { id: 'Upper', label: 'Upper arch',        accept: '.stl,.ply,.obj', required: true },
    { id: 'Lower', label: 'Lower arch',        accept: '.stl,.ply,.obj', required: true },
    { id: 'Bite',  label: 'Bite registration', accept: '.stl,.ply,.obj', required: false },
    { id: 'CBCT',  label: 'CBCT',              accept: '.dcm,.zip',      required: true,
      hint: 'DICOM study — zip the folder' },
  ],
  default: [
    { id: 'Upper', label: 'Upper arch',        accept: '.stl,.ply,.obj', required: true },
    { id: 'Lower', label: 'Lower arch',        accept: '.stl,.ply,.obj', required: true },
    { id: 'Bite',  label: 'Bite registration', accept: '.stl,.ply,.obj', required: false },
  ],
};

const GST_RATE = 0.05; // Published prices are ex-GST; 5% added at checkout.
const rupees = (paise) =>
  '₹' + Math.round(paise / 100).toLocaleString('en-IN');

// Memoized reference photo preview — avoids blob URL memory leak
const RefPhotoPreview = ({ file, onRemove }) => {
  const previewUrl = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  return (
    <div className={styles.refPhotoPreview}>
      <img src={previewUrl} alt="Reference" />
      <button type="button" onClick={onRemove} className={styles.btnOutline}>Remove</button>
    </div>
  );
};

const NewCase = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { addCase, getCaseById, updateCaseData, uploadDesignFile } = useCases();
  const { user } = useAuth();
  const { showToast } = useNotifications();
  const { tourPending, startCoachTour, showCoachTour, endTourSilently, fireConfetti } = useOnboarding();
  const [step, setStep] = useState(1);
  const [submittedId, setSubmittedId] = useState('');
  const [errors, setErrors] = useState({});
  const [formData, setFormData] = useState({
    caseType: '',
    specificType: '',
    patientName: '',
    toothNumbers: [],
    archTarget: 'both',
    material: '',
    materialSkuId: '',
    finishingTier: 'standard',
    referencePhoto: null,
    shade: 'A1',
    implantSystem: '',
    // Category-specific pricing inputs
    implantCount: '',
    virtualSurgicalPlan: false,
    alignerTier: '',
    extraAlignerSets: 0,
    files: []
  });
  const [rules, setRules] = useState(null);
  const [catalogMaterials, setCatalogMaterials] = useState([]);
  const [allMaterials, setAllMaterials] = useState([]);
  const [shades, setShades] = useState([]);
  const [presets, setPresets] = useState([]);
  // Scan Day: { credits: [...], progress: {...} | null }
  const [scanDay, setScanDay] = useState(null);

  // ─── Scan slots ───────────────────────────────────────────────
  // Which roles this case needs, and which are still missing. An arch
  // the case does not treat is not required — an upper-only retainer
  // should not demand a lower scan.
  const scanSlots = useMemo(() => {
    const slots = SCAN_SLOTS[formData.caseType] || SCAN_SLOTS.default;
    const archScoped = ['aligner', 'retainer', 'splint'].includes(formData.caseType);
    return slots.map(s => {
      if (!archScoped || !['Upper', 'Lower'].includes(s.id)) return s;
      const treatsThisArch =
        formData.archTarget === 'both' || formData.archTarget === s.id.toLowerCase();
      return { ...s, required: s.required && treatsThisArch };
    });
  }, [formData.caseType, formData.archTarget]);

  const filesForRole = useCallback(
    (roleId) => formData.files.filter(f => f.name.startsWith(roleId + SCAN_ROLE_SEP)),
    [formData.files]
  );

  const missingScans = scanSlots.filter(s => s.required && filesForRole(s.id).length === 0);

  const addFilesToRole = (roleId, incoming) => {
    // One file per role: re-dropping replaces rather than piles up.
    const prefix = roleId + SCAN_ROLE_SEP;
    const renamed = incoming.map(f => new File([f], prefix + f.name, { type: f.type }));
    setFormData(prev => ({
      ...prev,
      files: [...prev.files.filter(f => !f.name.startsWith(prefix)), ...renamed.slice(0, 1)],
    }));
  };

  const removeFileFromRole = (roleId) => {
    const prefix = roleId + SCAN_ROLE_SEP;
    setFormData(prev => ({ ...prev, files: prev.files.filter(f => !f.name.startsWith(prefix)) }));
  };

  // Anything that is not one of the named roles.
  const extraFiles = formData.files.filter(
    f => !scanSlots.some(s => f.name.startsWith(s.id + SCAN_ROLE_SEP))
  );
  // 20 swatches is a wall of colour on a step that already has no
  // headroom. Show the chosen shade; open the palette on demand.
  const [shadeOpen, setShadeOpen] = useState(false);

  // Cheapest SKU per case type, so the category grid can quote a real
  // "from" price rather than leaving the doctor to guess.
  const fromPriceByType = useMemo(() => {
    const out = {};
    allMaterials.forEach(m => {
      if (!m.basePrice) return;
      (m.caseTypes || []).forEach(ct => {
        if (out[ct] === undefined || m.basePrice < out[ct]) out[ct] = m.basePrice;
      });
    });
    return out;
  }, [allMaterials]);

  // Live estimate. Mirrors the server's pricing rules in
  // routes/cases.js so the figure quoted here is the figure invoiced.
  const estimate = useMemo(() => {
    const f = formData;
    const lines = [];
    const push = (label, amount) => lines.push({ label, amount });

    // Categories the price list does not cover yet.
    if (rules?.quoteOnRequest?.[f.caseType]) {
      return { quoteOnRequest: rules.quoteOnRequest[f.caseType] };
    }

    if (f.caseType === 'aligner') {
      const tier = rules?.alignerTiers?.find(t => t.id === f.alignerTier);
      if (!tier) return null;
      const extra = Math.max(Number(f.extraAlignerSets) || 0, 0);
      if (tier.unlimited) {
        const both = f.archTarget === 'both';
        push(`${tier.label} — ${both ? 'both arches' : 'single arch'}`, both ? tier.bothArchPaise : tier.perArchPaise);
      } else if (tier.payPerSet) {
        const sets = Math.max(extra, 1);
        push(`${tier.label} — ${sets} set${sets > 1 ? 's' : ''}`, tier.perSetPaise * sets);
      } else {
        push(`${tier.label} — ${tier.includedSets} sets`, tier.casePaise);
        if (extra > 0) push(`${extra} extra set${extra > 1 ? 's' : ''}`, tier.extraSetPaise * extra);
      }
    } else if (f.caseType === 'surgical_guide') {
      const n = f.toothNumbers.length;
      if (!n) return null;
      if (n > (rules?.guideMaxImplants ?? 6)) {
        return { quoteOnRequest: 'Full-arch and edentulous guides are quoted individually — contact the lab.' };
      }
      push(`Surgical guide — ${n} implant${n > 1 ? 's' : ''}`, rules?.guidePricing?.[n] || 0);
      if (f.virtualSurgicalPlan) push('Virtual surgical planning', rules?.vspAddOnPaise || 0);
    } else {
      const sku = catalogMaterials.find(m => m.id === f.materialSkuId);
      if (!sku?.basePrice) return null;
      const units = Math.max(f.toothNumbers.length, 1);

      if (f.caseType === 'veneer') {
        const rule = rules?.veneerRules?.[sku.slug];
        if (!rule) return null;
        if (rule.includedUnits > 0) {
          push(`${sku.displayName} — base case (${rule.includedUnits} teeth)`, rule.basePaise);
          const extra = Math.max(units - rule.includedUnits, 0);
          if (extra > 0) push(`${extra} additional ${extra > 1 ? 'teeth' : 'tooth'}`, rule.extraUnitPaise * extra);
        } else {
          push(`${sku.displayName} × ${units}`, rule.extraUnitPaise * units);
        }
      } else {
        const perUnit = ['crown_bridge', 'inlay_onlay'].includes(f.caseType);
        const qty = perUnit ? units : 1;
        push(qty > 1 ? `${sku.displayName} × ${qty} units` : sku.displayName, sku.basePrice * qty);
      }

      if (f.finishingTier === 'premium' && sku.premiumUpcharge) {
        const isBridge = f.specificType === 'Multi-Unit Bridge';
        push('Signature Match finishing',
          isBridge ? Math.round(sku.premiumUpcharge * (120 / 199)) * units : sku.premiumUpcharge);
      }
    }

    if (!lines.length) return null;
    const net = lines.reduce((s, l) => s + l.amount, 0);
    // The rate depends on what is being made — aligners are taxed at 8%,
    // prosthetics at 5%. Both the rate and the table come from the
    // server so this estimate cannot drift from the invoice.
    const gstRate = rules?.gstRateByCaseType?.[formData.caseType]
      ?? rules?.gstRate
      ?? GST_RATE;
    const gst = Math.round(net * gstRate);
    return { lines, net, gst, gstRate, total: net + gst };
  }, [rules, catalogMaterials, formData]);

  useEffect(() => {
    if (user?.id) {
      const saved = localStorage.getItem(`hesyra_presets_${user.id}`);
      if (saved) setPresets(JSON.parse(saved));
    }
  }, [user]);

  // Fetch shades palette + the full catalogue on mount
  useEffect(() => {
    const token = sessionStorage.getItem('hesyra_token');
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    fetch(`${API}/api/catalog/shades`, auth)
      .then(r => r.json()).then(setShades).catch(() => {});
    fetch(`${API}/api/catalog/materials`, auth)
      .then(r => r.json()).then(d => setAllMaterials(Array.isArray(d) ? d : [])).catch(() => {});
    fetch(`${API}/api/catalog/pricing-rules`, auth)
      .then(r => r.json()).then(setRules).catch(() => {});
    // Complimentary crowns this clinic has earned but not yet spent.
    fetch(`${API}/api/scan-day/my-credits`, auth)
      .then(r => r.ok ? r.json() : null).then(d => d && setScanDay(d)).catch(() => {});
  }, []);

  // Fetch materials when caseType changes
  useEffect(() => {
    if (!formData.caseType) { setCatalogMaterials([]); return; }
    // Reset SKU-related fields when case type changes to prevent stale selections
    // A complimentary crown only applies to crown & bridge, so a change
    // of category must drop it rather than silently carry it over.
    //
    // toothNumbers goes too. Teeth marked for a crown mean nothing on an
    // aligner, and on a surgical guide they are worse than meaningless:
    // the implant count — and therefore the price — is derived from
    // them, so carrying four crown teeth across quoted a ₹2,750
    // four-implant guide for sites the doctor never marked.
    setFormData(prev => ({
      ...prev,
      materialSkuId: null, material: '', finishingTier: 'standard', referencePhoto: null,
      useCrownCredit: false, crownCreditId: null,
      toothNumbers: [],
    }));
    const token = sessionStorage.getItem('hesyra_token');
    fetch(`${API}/api/catalog/materials?caseType=${formData.caseType}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(data => {
        setCatalogMaterials(Array.isArray(data) ? data : []);
        // Deliberately NOT auto-selected. The first row of the crown
        // catalogue is "Ceramic Ultra" at ₹1,800 — a legacy SKU priced
        // level with ELITE — so defaulting to it quietly put the most
        // expensive option on every prescription nobody had touched.
        // Material spans ₹950–₹1,800; that is the doctor's call to make.
      }).catch(() => setCatalogMaterials([]));
  }, [formData.caseType]);

  // Auto-start coach tour if pending
  useEffect(() => {
    if (tourPending && step === 1) {
      // Small delay to let the form render
      const t = setTimeout(() => startCoachTour(), 500);
      return () => clearTimeout(t);
    }
  }, [tourPending, step, startCoachTour]);

  const savePreset = () => {
    const name = window.prompt("Enter a name for this template (e.g., 'Standard Zirconia Crown Profile'):");
    if (!name) return;
    const newPreset = { name, data: { ...formData, patientName: '', files: [], toothNumbers: [] } };
    const updated = [...presets, newPreset];
    setPresets(updated);
    localStorage.setItem(`hesyra_presets_${user.id}`, JSON.stringify(updated));
    showToast(`Template "${name}" saved!`, 'success');
  };

  const loadPreset = (presetObj) => {
    setFormData(prev => ({ ...prev, ...presetObj.data }));
    setStep(2);
    showToast(`Loaded template "${presetObj.name}"`, 'success');
  };

  useEffect(() => {
    if (id) {
      const draft = getCaseById(id);
      if (draft && draft.status === 'draft') {
        setFormData({
          caseType: draft.caseType || '',
          specificType: draft.specificType || draft.type || '',
          patientName: draft.patient || '',
          toothNumbers: draft.toothNumbers || [],
          archTarget: draft.archTarget || 'both',
          material: draft.material || 'Permanent Crown Resin (e.g. VarseoSmile)',
          shade: draft.shade || 'A1',
          implantSystem: draft.implantSystem || '',
          instructions: draft.instructions || '',
          files: draft.files || []
        });
        if (draft.caseType) setStep(2);
      }
    }
  }, [id, getCaseById]);

  const upperTeeth = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const lowerTeeth = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

  const archAwareSort = (teethArray) => {
    return [...teethArray].sort((a, b) => {
      let idxA = upperTeeth.indexOf(a);
      let idxB = upperTeeth.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      idxA = lowerTeeth.indexOf(a);
      idxB = lowerTeeth.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      return upperTeeth.includes(a) ? -1 : 1;
    });
  };

  const getNeighbors = (selected) => {
    const neighbors = new Set();
    selected.forEach(t => {
      const uIdx = upperTeeth.indexOf(t);
      if (uIdx > 0) neighbors.add(upperTeeth[uIdx - 1]);
      if (uIdx > -1 && uIdx < upperTeeth.length - 1) neighbors.add(upperTeeth[uIdx + 1]);
      
      const lIdx = lowerTeeth.indexOf(t);
      if (lIdx > 0) neighbors.add(lowerTeeth[lIdx - 1]);
      if (lIdx > -1 && lIdx < lowerTeeth.length - 1) neighbors.add(lowerTeeth[lIdx + 1]);
    });
    selected.forEach(t => neighbors.delete(t));
    return Array.from(neighbors);
  };

  const getContiguousGroups = (selected) => {
    if (!selected.length) return [];
    const sorted = archAwareSort(selected);
    const groups = [];
    let currentGroup = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
        const t = sorted[i];
        const prevT = currentGroup[currentGroup.length - 1];
        let isAdjacent = false;
        const uIdx = upperTeeth.indexOf(t);
        const lIdx = lowerTeeth.indexOf(t);
        if (uIdx !== -1 && upperTeeth.indexOf(prevT) === uIdx - 1) isAdjacent = true;
        if (lIdx !== -1 && lowerTeeth.indexOf(prevT) === lIdx - 1) isAdjacent = true;
        
        if (isAdjacent) currentGroup.push(t);
        else {
            groups.push(currentGroup);
            currentGroup = [t];
        }
    }
    groups.push(currentGroup);
    return groups;
  };

  const suggestedTeeth = formData.specificType === 'Multi-Unit Bridge' ? getNeighbors(formData.toothNumbers) : [];
  const contiguousGroups = getContiguousGroups(formData.toothNumbers);

  const getDisplayType = (fData) => {
    if (fData.specificType) {
      if (fData.specificType === 'Multi-Unit Bridge' && fData.toothNumbers.length > 0) {
        return `${fData.toothNumbers.length}-UNIT BRIDGE`;
      }
      return fData.specificType.toUpperCase();
    }
    return (fData.caseType || 'Draft').replace('_', ' & ').toUpperCase();
  };

  const toggleTooth = (toothNum) => {
    setFormData(prev => {
      const teeth = [...prev.toothNumbers];
      if (teeth.includes(toothNum)) {
        return { ...prev, toothNumbers: teeth.filter(t => t !== toothNum) };
      } else {
        return { ...prev, toothNumbers: archAwareSort([...teeth, toothNum]) };
      }
    });
  };

  // Every field the lab needs before it can act on the case. A gap here
  // becomes a phone call later, so nothing advances until it is filled.
  const validateStep2 = () => {
    const e = {};
    const f = formData;

    if (!f.patientName.trim()) e.patientName = 'Patient reference is required';

    if (['crown_bridge', 'retainer', 'splint', 'denture', 'veneer'].includes(f.caseType) && !f.specificType) {
      e.specificType = 'Select the specific type';
    }

    // Tooth selection — these are priced per unit, so an empty arch
    // means an unpriceable case.
    if (['crown_bridge', 'veneer', 'inlay_onlay'].includes(f.caseType) && f.toothNumbers.length === 0) {
      e.toothNumbers = 'Select at least one tooth';
    }

    // A bridge is by definition more than one unit.
    if (f.caseType === 'crown_bridge' && f.specificType === 'Multi-Unit Bridge' && f.toothNumbers.length < 2) {
      e.toothNumbers = 'A multi-unit bridge needs at least two teeth';
    }

    // Material, wherever the category offers one.
    if (catalogMaterials.length > 0 && !f.materialSkuId) {
      e.materialSkuId = 'Select a material';
    }

    // Aligners are priced by treatment tier.
    if (f.caseType === 'aligner') {
      if (!f.alignerTier) e.alignerTier = 'Select a treatment tier';
      const tier = rules?.alignerTiers?.find(t => t.id === f.alignerTier);
      if (tier?.payPerSet && (!Number(f.extraAlignerSets) || Number(f.extraAlignerSets) < 1)) {
        e.extraAlignerSets = 'Enter how many sets are needed';
      }
    }

    // Guides are priced per implant — the count is the number of sites
    // marked on the arch.
    if (f.caseType === 'surgical_guide') {
      const n = f.toothNumbers.length;
      if (n < 1) e.implantCount = 'Mark at least one implant site on the arch';
      else if (n > (rules?.guideMaxImplants ?? 6)) {
        e.implantCount = `${n} sites is a full-arch guide — those are quoted individually, please contact the lab`;
      }
      if (!f.implantSystem) e.implantSystem = 'Select the implant system';
    }

    // Shade, where the chosen material takes one.
    const selMat = catalogMaterials.find(m => m.id === f.materialSkuId);
    if (selMat?.shadeApplicable && ['crown_bridge', 'veneer', 'denture', 'inlay_onlay'].includes(f.caseType) && !f.shade) {
      e.shade = 'Select a shade';
    }

    if (f.finishingTier === 'premium' && !f.referencePhoto) {
      e.referencePhoto = 'Signature Match needs a reference photo of the adjacent teeth';
    }

    // Categories with no published rate cannot be ordered here.
    if (rules?.quoteOnRequest?.[f.caseType]) {
      e.caseType = rules.quoteOnRequest[f.caseType];
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (step === 2 && !validateStep2()) {
      showToast('Please complete all required fields.', 'error');
      // Bring the first problem into view rather than making them hunt.
      requestAnimationFrame(() => {
        const el = document.querySelector(`.${styles.errorText}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    setStep(step + 1);
  };
  const handleBack = () => setStep(step - 1);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFormData({ ...formData, files: [...formData.files, ...selectedFiles] });
  };

  const [depositData, setDepositData] = useState(null); // To store deposit info if required

  const handleSaveDraft = async (e) => {
    if (e) e.preventDefault();
    if (id) {
      updateCaseData(id, {
        patient: formData.patientName || 'Draft Patient',
        caseType: formData.caseType || '',
        type: getDisplayType(formData),
        ...formData
      });
      showToast('Draft updated successfully!', 'success');
      navigate('/');
    } else {
      const result = await addCase({...formData, type: getDisplayType(formData)}, true, user);
      if (result) {
        // showToast is handled in addCase
        navigate('/');
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Global Submission Validation.
    // Counting files was not enough: one upper-arch STL satisfied it and
    // the case reached the lab without the opposing arch.
    if (missingScans.length > 0) {
      showToast(
        `Still needed before this can go to the lab: ${missingScans.map(s => s.label).join(', ')}.`,
        'error'
      );
      return;
    }

    let caseId = id;

    if (id) {
      updateCaseData(id, {
        status: 'submitted',
        patient: formData.patientName,
        caseType: formData.caseType,
        type: getDisplayType(formData),
        ...formData
      });
      // We don't have deposit checks natively for updating a draft right now, 
      // but assuming the backend would enforce it if it wasn't a draft anymore.
      // For now, we'll just set step to 4.
      setSubmittedId(id);
      setStep(4);
    } else {
      const result = await addCase({...formData, type: getDisplayType(formData)}, false, user);
      if (result) {
        caseId = result.id;
        
        // Upload files via multipart to the newly created case
        if (formData.files.length > 0) {
          try {
            await uploadDesignFile(caseId, formData.files, 'scan');
          } catch (uploadErr) {
            console.error('File upload failed after case creation:', uploadErr);
            showToast('Case created but file upload failed. Please upload files from Case Details.', 'warning');
          }
        }

        // Upload reference photo for Signature Match (separate from scan files)
        if (formData.finishingTier === 'premium' && formData.referencePhoto) {
          try {
            const refResult = await uploadDesignFile(caseId, [formData.referencePhoto], 'reference_photo');
            // Update case with referencePhotoUrl
            if (refResult && refResult.length > 0) {
              await updateCaseData(caseId, { referencePhotoUrl: refResult[0].url });
            }
          } catch (refErr) {
            console.error('Reference photo upload failed:', refErr);
            showToast('Case created but reference photo upload failed. Please upload from Case Details.', 'warning');
          }
        }

        // Check for deposit requirement (Strike 1 or 2)
        if (result.depositRequired > 0) {
          setDepositData(result);
          setStep(3.5); // Deposit Collection Step
          return;
        }

        setSubmittedId(caseId);
        setStep(4);
      }
    }
  };

  return (
    <div className={styles.container}>
      {/* Coach Tour overlay */}
      {showCoachTour && <CoachTour />}

      <header className={styles.header}>
        <Link to="/" className={styles.backLink}>
          <ChevronLeft size={20} /> Back to Dashboard
        </Link>
        <h1 className={styles.title}>Submit New Request</h1>
        <p className={styles.subtitle}>Our adaptive form will guide you based on the requirement of the case.</p>
      </header>

      {/* Three states, not two. `step >= n` painted the current step and
          every finished one identically, so on step 2 you could not tell
          which of the first two you were actually on. Finished steps are
          also the way back — they were the only part of this header that
          looked clickable and wasn't. */}
      <div className={styles.stepIndicator}>
        {['Case type', 'Prescription', 'Scans'].map((label, i) => {
          const n = i + 1;
          const done = step > n;
          const current = step === n;
          return (
            <React.Fragment key={label}>
              {i > 0 && <div className={`${styles.stepLine} ${step > i ? styles.stepLineDone : ''}`} />}
              <button
                type="button"
                className={`${styles.step} ${done ? styles.stepDone : ''} ${current ? styles.stepCurrent : ''}`}
                aria-current={current ? 'step' : undefined}
                disabled={!done}
                onClick={() => done && setStep(n)}
              >
                <span className={styles.stepMark}>{done ? <Check size={11} strokeWidth={3} /> : n}</span>
                {label}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      <div className={styles.formCard}>
        {/* STEP 1: CATEGORY SELECTION */}
        {step === 1 && (
          <div className={styles.formSection}>
            {presets.length > 0 && (
              <div style={{marginBottom: '2rem', background: 'rgba(0,0,0,0.15)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--brand-bioceramic)'}}>
                <h3 style={{fontSize: '1rem', marginBottom: '1rem', color: 'var(--brand-bioceramic)', display: 'flex', alignItems: 'center', gap: '8px'}}>
                  <Layers size={18} /> Quick-Load Templates
                </h3>
                <div style={{display: 'flex', gap: '12px', flexWrap: 'wrap'}}>
                  {presets.map((p, i) => (
                    <button key={i} onClick={() => loadPreset(p)} className={styles.btnOutline} style={{borderColor: 'var(--brand-bioceramic)', color: 'var(--text-primary)'}}>
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Select a case type</h2>
              <p className={styles.sectionHint}>
                Prices shown are per unit, exclusive of GST. Turnaround is measured
                from receipt of an accepted scan.
              </p>
            </div>

            {/* Reads as a price list: category, description, rate,
                turnaround — in aligned columns, with no decoration
                competing with the numbers. */}
            <div className={styles.catalogue} data-tour-target="sku">
              <div className={styles.catalogueHead}>
                <span>Case type</span>
                <span className={styles.colRight}>From</span>
                <span className={styles.colRight}>Turnaround</span>
              </div>

              <div className={styles.catalogueBody}>
              {CASE_GROUPS.map(group => (
                <section key={group} className={styles.catalogueGroup}>
                  <h3 className={styles.groupLabel}>{group}</h3>

                  {CASE_TYPES.filter(t => t.group === group).map(type => {
                    const isSelected = formData.caseType === type.id;
                    const from = fromPriceByType[type.id];
                    return (
                      <button key={type.id}
                        type="button"
                        aria-pressed={isSelected}
                        className={`${styles.typeRow} ${isSelected ? styles.typeRowSelected : ''}`}
                        onClick={() => setFormData({...formData, caseType: type.id, specificType: formData.caseType === type.id ? formData.specificType : ''})}>
                        <span className={styles.typeBody}>
                          <span className={styles.typeName}>{type.name}</span>
                          <span className={styles.typeDesc}>{type.desc}</span>
                        </span>
                        <span className={`${styles.typePrice} ${styles.colRight}`}>
                          {from
                            ? <><span className={styles.typePriceFrom}>₹</span>{Math.round(from / 100).toLocaleString('en-IN')}</>
                            : <span className={styles.typeQuoted}>On request</span>}
                        </span>
                        <span className={`${styles.typeTurnaround} ${styles.colRight}`}>{type.turnaround}</span>
                      </button>
                    );
                  })}
                </section>
              ))}
              </div>
            </div>
            <div className={styles.formActions} style={{display: 'flex', gap: '12px', justifyContent: 'flex-end'}}>
              <button className={styles.btnOutline} onClick={handleSaveDraft} disabled={!formData.caseType}>Save Draft</button>
              <button className={styles.btnPrimary} onClick={handleNext} disabled={!formData.caseType}>
                Continue <ChevronLeft size={16} style={{transform: 'rotate(180deg)'}} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: DYNAMIC PRESCRIPTION */}
        {step === 2 && (
          <div className={styles.formSection}>
            <div className={styles.rxLayout}>
            <div className={styles.rxMain}>
            {/* No section title. The step pill above says PRESCRIPTION
                and the summary rail's first row already says which case
                type this is — a third statement of it cost a line of
                height the columns needed. */}

            {/* Everything stays in the balancing column flow. Pulling
                Patient and Restoration out to give the arch full width
                cost 198px of height and bought the teeth 2px — the arch
                only reached 577px in the wide cell against 490px in the
                column, because the summary rail takes the rest either
                way. The arch redesign is what mattered, not the width. */}
            <div className={styles.rxCols}>
            <div className={styles.rxCol}>

            <div className={styles.fieldset}>
              <div className={styles.fieldsetLegend}>Patient</div>

            {/* No label: the legend above already says "Patient" and the
                placeholder shows the expected format. */}
            <div className={styles.inputGroup} data-tour-target="patient">
              <input type="text" placeholder="Patient name or reference — e.g. John Doe · JD104"
                aria-label="Patient reference or name"
                className={errors.patientName ? styles.inputError : ''}
                value={formData.patientName}
                onChange={(e) => {
                  setFormData({...formData, patientName: e.target.value});
                  if (errors.patientName) setErrors({...errors, patientName: null});
                }} />
              {errors.patientName && <span className={styles.errorText}>{errors.patientName}</span>}
            </div>
            </div>

            <div className={`${styles.fieldset} ${styles.rxRestoration}`}>
              <div className={styles.fieldsetLegend}>Restoration</div>

            {formData.caseType === 'crown_bridge' && (
              <div className={styles.inputGroup}>
                <label className={errors.specificType ? styles.labelError : ''}>Type</label>
                <select value={formData.specificType} onChange={e => {
                  setFormData({...formData, specificType: e.target.value});
                  if (errors.specificType) setErrors({...errors, specificType: null});
                }} className={errors.specificType ? styles.inputError : ''}>
                  <option value="">Select Restoration Type...</option>
                  <option value="Single Crown">Single Crown</option>
                  <option value="Multi-Unit Bridge">Multi-Unit Bridge</option>
                </select>
                {errors.specificType && <span className={styles.errorText}>{errors.specificType}</span>}
              </div>
            )}

            {formData.caseType === 'retainer' && (
              <div className={styles.inputGroup}>
                <label className={errors.specificType ? styles.labelError : ''}>Retainer Type</label>
                <select value={formData.specificType} onChange={e => {
                  setFormData({...formData, specificType: e.target.value});
                  if (errors.specificType) setErrors({...errors, specificType: null});
                }} className={errors.specificType ? styles.inputError : ''}>
                  <option value="">Select Retainer Type...</option>
                  <option value="Essix Retainer (Clear)">Essix Retainer (Clear)</option>
                  <option value="Hawley Retainer">Hawley Retainer</option>
                  <option value="Fixed Lingual Retainer">Fixed Lingual Retainer</option>
                </select>
                {errors.specificType && <span className={styles.errorText}>{errors.specificType}</span>}
              </div>
            )}

            {formData.caseType === 'splint' && (
              <div className={styles.inputGroup}>
                <label className={errors.specificType ? styles.labelError : ''}>Appliance Type</label>
                <select value={formData.specificType} onChange={e => {
                  setFormData({...formData, specificType: e.target.value});
                  if (errors.specificType) setErrors({...errors, specificType: null});
                }} className={errors.specificType ? styles.inputError : ''}>
                  <option value="">Select Appliance Type...</option>
                  <option value="Hard Nightguard">Hard Nightguard</option>
                  <option value="Soft Nightguard">Soft Nightguard</option>
                  <option value="Dual-Laminate Guard">Dual-Laminate Guard</option>
                  <option value="TMJ Repositioning Splint">TMJ Repositioning Splint</option>
                </select>
                {errors.specificType && <span className={styles.errorText}>{errors.specificType}</span>}
              </div>
            )}

            {formData.caseType === 'denture' && (
              <div className={styles.inputGroup}>
                <label className={errors.specificType ? styles.labelError : ''}>Denture Type</label>
                <select value={formData.specificType} onChange={e => {
                  setFormData({...formData, specificType: e.target.value});
                  if (errors.specificType) setErrors({...errors, specificType: null});
                }} className={errors.specificType ? styles.inputError : ''}>
                  <option value="">Select Denture Type...</option>
                  <option value="Full Denture (Upper)">Full Denture (Upper)</option>
                  <option value="Full Denture (Lower)">Full Denture (Lower)</option>
                  <option value="Full Denture (Both Arches)">Full Denture (Both Arches)</option>
                  <option value="Partial Denture">Partial Denture</option>
                  <option value="Implant-Supported Overdenture">Implant-Supported Overdenture</option>
                </select>
                {errors.specificType && <span className={styles.errorText}>{errors.specificType}</span>}
              </div>
            )}

            {/* ─── Clear aligner treatment tier ─── */}
            {formData.caseType === 'aligner' && rules?.alignerTiers && (
              <div className={styles.inputGroup}>
                <label className={errors.alignerTier ? styles.labelError : ''}>Treatment Tier</label>
                {errors.alignerTier && <span className={styles.errorText}>{errors.alignerTier}</span>}
                <div className={styles.tierList}>
                  {rules.alignerTiers.map(t => (
                    <button key={t.id} type="button"
                      aria-pressed={formData.alignerTier === t.id}
                      className={`${styles.tierRow} ${formData.alignerTier === t.id ? styles.tierRowSelected : ''}`}
                      onClick={() => setFormData({ ...formData, alignerTier: t.id })}>
                      <span className={styles.tierRowBody}>
                        <span className={styles.tierRowName}>{t.label}</span>
                        <span className={styles.tierRowNote}>{t.note}</span>
                      </span>
                      <span className={styles.tierRowPrice}>
                        {t.unlimited
                          ? `${rupees(formData.archTarget === 'both' ? t.bothArchPaise : t.perArchPaise)}`
                          : t.payPerSet
                            ? `${rupees(t.perSetPaise)} / set`
                            : rupees(t.casePaise)}
                        {!t.unlimited && !t.payPerSet && (
                          <span className={styles.tierRowUnit}>{t.includedSets} sets</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formData.caseType === 'aligner' && formData.alignerTier &&
             !rules?.alignerTiers?.find(t => t.id === formData.alignerTier)?.unlimited && (
              <div className={styles.inputGroup}>
                <label>
                  {rules?.alignerTiers?.find(t => t.id === formData.alignerTier)?.payPerSet
                    ? 'Number of sets' : 'Extra sets beyond those included'}
                </label>
                <input type="number" min="0" max="60" value={formData.extraAlignerSets}
                  onChange={e => setFormData({ ...formData, extraAlignerSets: e.target.value })} />
                <span className={styles.helperText}>
                  Refinements and replacements beyond your included sets are billed at the extra-tray rate.
                </span>
              </div>
            )}

            {/* ─── Surgical guide: implant count comes from the sites
                marked on the arch below, so there is no separate number
                to keep in step with it. ─── */}
            {formData.caseType === 'surgical_guide' && (
              <div className={styles.inputGroup}>
                {errors.implantCount && <span className={styles.errorText}>{errors.implantCount}</span>}
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={formData.virtualSurgicalPlan}
                    onChange={e => setFormData({ ...formData, virtualSurgicalPlan: e.target.checked })} />
                  <span>
                    Add Virtual Surgical Planning
                    {rules?.vspAddOnPaise ? ` (+${rupees(rules.vspAddOnPaise)})` : ''}
                  </span>
                </label>
              </div>
            )}

            {formData.caseType === 'veneer' && (
              <div className={styles.inputGroup}>
                <label className={errors.specificType ? styles.labelError : ''}>Veneer Type</label>
                <select value={formData.specificType} onChange={e => {
                  setFormData({...formData, specificType: e.target.value});
                  if (errors.specificType) setErrors({...errors, specificType: null});
                }} className={errors.specificType ? styles.inputError : ''}>
                  <option value="">Select Veneer Type...</option>
                  <option value="Porcelain Veneer">Porcelain Veneer</option>
                  <option value="Composite Veneer">Composite Veneer</option>
                  <option value="Minimal Prep Veneer">Minimal Prep Veneer</option>
                  <option value="No-Prep Veneer (Lumineer)">No-Prep Veneer (Lumineer)</option>
                </select>
                {errors.specificType && <span className={styles.errorText}>{errors.specificType}</span>}
              </div>
            )}

            {(formData.caseType === 'surgical_guide' || formData.caseType === 'veneer' || (formData.caseType === 'crown_bridge' && formData.specificType)) && (
              <div className={styles.toothSelectorSection} data-tour-target="tooth">
                <label className={errors.toothNumbers ? styles.labelError : ''}>
                  {formData.caseType === 'surgical_guide' ? 'Implant sites' : 'Teeth'}
                  <span className={styles.labelHint}>FDI notation</span>
                  {errors.toothNumbers && <span className={styles.errorText} style={{marginLeft: '8px', display: 'inline-block'}}>— {errors.toothNumbers}</span>}
                </label>

                {/* An arch, not a table of numbers. Two rows of sixteen
                    identical buttons made you read every label to find a
                    tooth; curving them into facing arcs with a midline
                    lets a dentist point at the position instead. The
                    offset is k·t² from the midline, so the ends drop away
                    and the two arcs enclose the mouth. */}
                <div className={styles.archChart}>
                  <span className={`${styles.archSide} ${styles.archSideR}`} aria-hidden="true">R</span>
                  <span className={`${styles.archSide} ${styles.archSideL}`} aria-hidden="true">L</span>

                  {[upperTeeth, lowerTeeth].map((row, rowIdx) => (
                    <div key={rowIdx} className={styles.archRow}>
                      {row.map((num, i) => {
                        const t = (i - 7.5) / 7.5;          // −1 … 1 across the arch
                        const curve = 14 * t * t;           // 0 at the midline, 14 at the molars
                        const isSelected = formData.toothNumbers.includes(num);
                        const isSuggested = suggestedTeeth.includes(num);
                        return (
                          <button key={num} type="button"
                            onClick={() => toggleTooth(num)}
                            aria-pressed={isSelected}
                            aria-label={`Tooth ${num}`}
                            style={{
                              transform: `translateY(${rowIdx === 0 ? curve : 14 - curve}px)`,
                              // The midline gap — quadrant 1 from 2, 4 from 3.
                              marginRight: i === 7 ? '12px' : undefined,
                            }}
                            className={`${styles.toothBtn} ${isSelected ? styles.toothSelected : ''} ${isSuggested && !isSelected ? styles.toothSuggested : ''}`}>
                            {num}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>

                {/* Says what is selected without making you count buttons. */}
                <div className={styles.archFoot}>
                  {formData.toothNumbers.length === 0
                    ? <span className={styles.archFootEmpty}>
                        Select the {formData.caseType === 'surgical_guide' ? 'implant sites' : 'teeth'} this case covers
                      </span>
                    : <>
                        <strong>{formData.toothNumbers.length}</strong>
                        {formData.caseType === 'surgical_guide'
                          ? ` site${formData.toothNumbers.length > 1 ? 's' : ''}`
                          : formData.toothNumbers.length > 1 ? ' teeth' : ' tooth'}
                        <span className={styles.archFootList}>
                          {formData.toothNumbers.slice().sort((a, b) => a - b).join(', ')}
                        </span>
                      </>}
                </div>
              </div>
            )}

            {(formData.caseType === 'aligner' || formData.caseType === 'retainer' || formData.caseType === 'splint') && (
              <div className={styles.inputGroup}>
                <label>Target Arch</label>
                <div className={styles.archToggleGroup}>
                  {['upper', 'lower', 'both'].map(target => (
                    <button key={target}
                      className={`${styles.archBtn} ${formData.archTarget === target ? styles.archSelected : ''}`}
                      onClick={() => setFormData({...formData, archTarget: target})}>
                      {target.charAt(0).toUpperCase() + target.slice(1)} Arch
                    </button>
                  ))}
                </div>
              </div>
            )}

            </div>

            </div>
            <div className={styles.rxCol}>

            {/* Aligners and guides have no material choice — an empty
                section heading is just noise. */}
            {catalogMaterials.length > 0 && (
            <>
            <div className={styles.fieldset}>
              <div className={styles.fieldsetLegend}>Material</div>

            {/* ─── Dynamic Material Picker (from catalog) ─── */}
            {/* No label — the legend says "Material". The unit and the
                tax basis are stated once here instead of being repeated
                on all five cards. */}
            {catalogMaterials.length > 0 && (
              <div className={styles.inputGroup}>
                {errors.materialSkuId && <span className={styles.errorText}>{errors.materialSkuId}</span>}
                <div className={styles.materialGrid}>
                  {catalogMaterials.map(m => {
                    const isSelected = formData.materialSkuId === m.id;
                    return (
                      <button key={m.id} type="button"
                        aria-pressed={isSelected}
                        className={`${styles.materialCard} ${isSelected ? styles.materialCardSelected : ''}`}
                        onClick={() => setFormData({...formData, materialSkuId: m.id, material: m.displayName, shade: m.shadeApplicable ? formData.shade : ''})}>
                        <span className={styles.materialName}>{m.displayName}</span>
                        <span className={styles.materialMeta}>
                          {m.category && <span className={styles.materialCategory}>{m.category}</span>}
                          {m.basePrice > 0 && (
                            <span className={styles.materialPrice}>{rupees(m.basePrice)}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <span className={styles.materialFootnote}>
                  Per {formData.caseType === 'crown_bridge' ? 'unit' : 'case'}, before GST.
                  {catalogMaterials.some(m => m.finishingTiers?.includes('premium')) &&
                    ' Signature Match finishing is chosen below.'}
                </span>
              </div>
            )}

            </div>

            {/* Finish, shade and the reference photo live in their own
                block so the column balancer has smaller pieces to place
                — one tall Material box was forcing an uneven split. */}
            <div className={styles.fieldset}>
              <div className={styles.fieldsetLegend}>Finish &amp; shade</div>

            {/* ─── Finishing Tier ─── */}
            {formData.materialSkuId && (() => {
              const selMat = catalogMaterials.find(m => m.id === formData.materialSkuId);
              return selMat?.finishingTiers?.includes('premium') ? (
                <div className={styles.inputGroup}>
                  <label>Finishing Quality</label>
                  <div className={styles.tierToggle}>
                    <button type="button"
                      className={`${styles.tierBtn} ${formData.finishingTier === 'standard' ? styles.tierSelected : ''}`}
                      onClick={() => setFormData({...formData, finishingTier: 'standard', referencePhoto: null})}>
                      <strong>Studio Finish</strong>
                      <span>Professional glazing & polish · Included</span>
                    </button>
                    <button type="button"
                      className={`${styles.tierBtn} ${styles.tierPremium} ${formData.finishingTier === 'premium' ? styles.tierSelected : ''}`}
                      onClick={() => setFormData({...formData, finishingTier: 'premium'})}>
                      <strong>
                        Signature Match
                        {selMat?.premiumUpcharge > 0 && (
                          <span className={styles.tierPrice}>+{rupees(selMat.premiumUpcharge)}</span>
                        )}
                      </strong>
                      <span>Hand-stained characterisation matched to the adjacent dentition</span>
                    </button>
                  </div>
                </div>
              ) : null;
            })()}

            {/* ─── Reference Photo Upload (Signature Match only) ─── */}
            {formData.finishingTier === 'premium' && (
              <div className={styles.inputGroup}>
                <label className={styles.labelWithBadge}>
                  Adjacent Teeth Reference Photo
                  <span className={styles.requiredBadge}>Required</span>
                </label>
                <p className={styles.helperText} style={{marginBottom:'12px',fontSize:'0.8rem'}}>
                  Upload a well-lit digital photo of the adjacent natural teeth. Our ceramists use this as a color and translucency reference for a natural, undetectable match.
                </p>
                {formData.referencePhoto ? (
                  <RefPhotoPreview file={formData.referencePhoto} onRemove={() => setFormData({...formData, referencePhoto: null})} />
                ) : (
                  <label className={styles.refPhotoUpload}>
                    <UploadCloud size={28} />
                    <span>Click to upload reference photo</span>
                    <input type="file" accept="image/*" style={{display:'none'}} onChange={e => {
                      if (e.target.files[0]) setFormData({...formData, referencePhoto: e.target.files[0]});
                    }} />
                  </label>
                )}
              </div>
            )}

            {/* ─── VITA Shade Palette ─── */}
            {(() => {
              const selMat = catalogMaterials.find(m => m.id === formData.materialSkuId);
              if (selMat?.shadeApplicable === false || !['crown_bridge','veneer','denture'].includes(formData.caseType)) return null;

              const palette = shades.length > 0 ? shades : [
                {id:'A1',hex:'#f5e6c8'},{id:'A2',hex:'#ecd9b0'},{id:'A3',hex:'#dcc48e'},
                {id:'B1',hex:'#f0e4c6'},{id:'BL1',hex:'#faf6ee'},
              ];
              const chosen = palette.find(s => s.id === formData.shade);

              // Collapsed to a single swatch by default: the palette is
              // 20 wide and this step has no vertical headroom to spare.
              return (
                <div className={styles.inputGroup} data-tour-target="shade">
                  <label>Target Shade (VITA Classical)</label>
                  <button type="button"
                    className={styles.shadeTrigger}
                    aria-expanded={shadeOpen}
                    onClick={() => setShadeOpen(o => !o)}>
                    <span className={styles.shadeTriggerSwatch}
                      style={{'--swatch-color': chosen?.hex || '#f5e6c8'}} />
                    <span className={styles.shadeTriggerLabel}>{formData.shade || 'Select'}</span>
                    <span className={styles.shadeTriggerHint}>
                      {shadeOpen ? 'Close' : 'Change'}
                    </span>
                  </button>
                  {shadeOpen && (
                    <div className={styles.shadeGrid}>
                      {palette.map(s => (
                        <button key={s.id} type="button"
                          className={`${styles.shadeSwatch} ${formData.shade === s.id ? styles.shadeSelected : ''}`}
                          style={{'--swatch-color': s.hex}}
                          onClick={() => { setFormData({...formData, shade: s.id}); setShadeOpen(false); }}
                          title={s.name || s.id}>
                          <span className={styles.swatchColor} />
                          <span className={styles.swatchLabel}>{s.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {formData.caseType === 'surgical_guide' && (
              <div className={styles.inputGroup}>
                <label className={errors.implantSystem ? styles.labelError : ''}>Implant System</label>
                {errors.implantSystem && <span className={styles.errorText}>{errors.implantSystem}</span>}
                <select value={formData.implantSystem}
                  className={errors.implantSystem ? styles.inputError : ''}
                  onChange={(e) => setFormData({...formData, implantSystem: e.target.value})}>
                  <option value="">Select System...</option>
                  <option>Straumann Bone Level</option>
                  <option>Nobel Biocare Active</option>
                  <option>Zimmer Biomet TSV</option>
                  <option>BioHorizons Tapered</option>
                </select>
              </div>
            )}

            </div>
            </>
            )}

            <div className={styles.fieldset}>
              <div className={styles.fieldsetLegend}>Instructions</div>

            <div className={styles.inputGroup} data-tour-target="notes">
              <label>Special Instructions</label>
              <textarea rows="3"
                placeholder={
                  formData.caseType === 'aligner' ? "Specify IPR limits, attachment preferences, and main movement goals..." :
                  formData.caseType === 'surgical_guide' ? "Specify sleeve preferences and depth..." :
                  "Any special design requests, margin preferences, or occlusion details..."
                }
                value={formData.instructions}
                onChange={(e) => setFormData({...formData, instructions: e.target.value})}></textarea>
            </div>

            </div>
            </div>
            </div>

            <div className={styles.formActionsSpaceBetween}>
              <button className={styles.btnOutline} onClick={handleBack}>Back to Types</button>
              <div style={{display: 'flex', gap: '12px'}}>
                <button className={styles.btnOutline} onClick={(e) => { e.preventDefault(); savePreset(); }} title="Save current form configuration as a reusable template">Save as Template</button>
                <button className={styles.btnOutline} onClick={handleSaveDraft}>Save Draft</button>
                <button className={styles.btnPrimary} onClick={handleNext}>
                  Continue to Uploads
                </button>
              </div>
            </div>
            </div>

            {/* ─── Running cost summary ─── */}
            {/* Mirrors the server's pricing rules, so what the doctor
                sees here is what the invoice will say. */}
            <aside className={styles.rxAside}>
              <div className={styles.summaryCard}>
                <div className={styles.summaryHead}>Case summary</div>

                <dl className={styles.summaryList}>
                  <div className={styles.summaryRow}>
                    <dt>Type</dt>
                    <dd>{CASE_TYPES.find(t => t.id === formData.caseType)?.name || '—'}</dd>
                  </div>
                  {formData.specificType && (
                    <div className={styles.summaryRow}>
                      <dt>Variant</dt><dd>{formData.specificType}</dd>
                    </div>
                  )}
                  {catalogMaterials.length > 0 && (
                    <div className={styles.summaryRow}>
                      <dt>Material</dt>
                      <dd>{formData.material || 'Not selected'}</dd>
                    </div>
                  )}
                  {formData.caseType === 'surgical_guide' && formData.toothNumbers.length > 0 && (
                    <div className={styles.summaryRow}>
                      <dt>Implant sites</dt><dd>{formData.toothNumbers.length}</dd>
                    </div>
                  )}
                  {formData.toothNumbers.length > 0 && (
                    <div className={styles.summaryRow}>
                      <dt>Teeth</dt>
                      <dd>{formData.toothNumbers.slice().sort((a,b)=>a-b).join(', ')}</dd>
                    </div>
                  )}
                  <div className={styles.summaryRow}>
                    <dt>Turnaround</dt>
                    <dd>{CASE_TYPES.find(t => t.id === formData.caseType)?.turnaround || '—'}</dd>
                  </div>
                </dl>

                {estimate?.quoteOnRequest ? (
                  <>
                    <div className={styles.summaryDivider} />
                    <p className={styles.summaryNote}>{estimate.quoteOnRequest}</p>
                  </>
                ) : estimate ? (
                  <>
                    <div className={styles.summaryDivider} />
                    <dl className={styles.summaryList}>
                      {estimate.lines.map((l, i) => (
                        <div key={i} className={styles.summaryRow}>
                          <dt>{l.label}</dt>
                          <dd className={styles.num}>{rupees(l.amount)}</dd>
                        </div>
                      ))}
                      <div className={styles.summaryRow}>
                        <dt>GST @ {Math.round(estimate.gstRate * 100)}%</dt>
                        <dd className={styles.num}>{rupees(estimate.gst)}</dd>
                      </div>
                    </dl>

                    {/* Scan Day — a complimentary crown is an entitlement
                        against this case, not wallet money. Only shown
                        when the clinic actually holds one. */}
                    {formData.caseType === 'crown_bridge' && scanDay?.credits?.length > 0 && (
                      <label className={styles.creditOffer}>
                        <input
                          type="checkbox"
                          checked={!!formData.useCrownCredit}
                          onChange={e => setFormData({
                            ...formData,
                            useCrownCredit: e.target.checked,
                            crownCreditId: e.target.checked ? scanDay.credits[0].id : null,
                          })}
                        />
                        <span>
                          <strong>Use a complimentary crown</strong>
                          <span className={styles.creditMeta}>
                            {scanDay.credits.length} available
                            {scanDay.credits[0].tierLabel ? ` · ${scanDay.credits[0].tierLabel}` : ''}
                          </span>
                        </span>
                      </label>
                    )}

                    <div className={styles.summaryTotal}>
                      <span>Payable at dispatch</span>
                      <strong>
                        {formData.useCrownCredit ? rupees(0) : rupees(estimate.total)}
                      </strong>
                    </div>
                    <p className={styles.summaryNote}>
                      {formData.useCrownCredit
                        ? 'Covered by a Scan Day crown. Nothing to pay on this case.'
                        : 'No advance payment. You are billed only when the case ships.'}
                    </p>
                  </>
                ) : (
                  <p className={styles.summaryNote}>
                    Complete the prescription to see the price for this case.
                  </p>
                )}
              </div>
            </aside>
            </div>
          </div>
        )}

        {/* STEP 3: UPLOADS */}
        {step === 3 && (
          <div className={styles.formSection}>
            <div className={styles.uploadHead}>
              <h2 className={styles.sectionTitleCompact}>Scans</h2>
              <span className={missingScans.length ? styles.uploadPending : styles.uploadReady}>
                {missingScans.length === 0
                  ? <><CheckCircle2 size={14} /> All required scans attached</>
                  : `${missingScans.length} still needed — ${missingScans.map(s => s.label).join(', ')}`}
              </span>
            </div>

            <div data-tour-target="scan" className={styles.scanSlots}>
              {scanSlots.map(slot => {
                const held = filesForRole(slot.id)[0];
                return (
                  <div key={slot.id}
                    className={`${styles.scanSlot} ${held ? styles.scanSlotFilled : ''} ${!held && slot.required ? styles.scanSlotNeeded : ''}`}>
                    <div className={styles.scanSlotHead}>
                      <span className={styles.scanSlotName}>{slot.label}</span>
                      <span className={slot.required ? styles.scanReq : styles.scanOpt}>
                        {slot.required ? 'Required' : 'Optional'}
                      </span>
                    </div>

                    {held ? (
                      <div className={styles.scanSlotFile}>
                        <FileType size={15} />
                        <span className={styles.scanFileName}
                          title={held.name.slice(slot.id.length + SCAN_ROLE_SEP.length)}>
                          {held.name.slice(slot.id.length + SCAN_ROLE_SEP.length)}
                        </span>
                        <span className={styles.scanFileSize}>
                          {held.size < 1024 * 1024
                            ? `${Math.max(1, Math.round(held.size / 1024))} KB`
                            : `${(held.size / 1024 / 1024).toFixed(1)} MB`}
                        </span>
                        <button type="button" className={styles.scanRemove}
                          onClick={() => removeFileFromRole(slot.id)}
                          aria-label={`Remove ${slot.label} scan`}>×</button>
                      </div>
                    ) : (
                      <label className={styles.scanDrop}
                        onDragOver={e => { e.preventDefault(); }}
                        onDrop={e => {
                          e.preventDefault();
                          const dropped = Array.from(e.dataTransfer.files);
                          if (dropped.length) addFilesToRole(slot.id, dropped);
                        }}>
                        <UploadCloud size={18} />
                        <span className={styles.scanDropText}>Drop or browse</span>
                        <span className={styles.scanFormats}>
                          {slot.accept.replace(/\./g, '').toUpperCase().replace(/,/g, ' · ')}
                        </span>
                        {slot.hint && <span className={styles.scanHint}>{slot.hint}</span>}
                        <input type="file" accept={slot.accept} style={{ display: 'none' }}
                          onChange={e => {
                            const picked = Array.from(e.target.files);
                            if (picked.length) addFilesToRole(slot.id, picked);
                            e.target.value = '';
                          }} />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Anything the named slots do not cover — photographs, a
                previous design, a note from the referring clinician. */}
            <details className={styles.extraFiles} open={extraFiles.length > 0}>
              <summary className={styles.extraSummary}>
                Additional files{extraFiles.length > 0 ? ` (${extraFiles.length})` : ''}
              </summary>
              <DragDropZone
                files={extraFiles}
                onFilesAdded={(newFiles) => setFormData(prev => ({ ...prev, files: [...prev.files, ...newFiles] }))}
                onFileRemoved={(index) => {
                  const target = extraFiles[index];
                  setFormData(prev => ({ ...prev, files: prev.files.filter(f => f !== target) }));
                }}
              />
            </details>

            <div className={styles.formActionsSpaceBetween}>
              <button className={styles.btnOutline} onClick={handleBack}>Back to Rx</button>
              <div style={{display: 'flex', gap: '12px'}}>
                <button className={styles.btnOutline} onClick={handleSaveDraft}>Save Draft</button>
                <button className={styles.btnPrimary} onClick={handleSubmit}>Submit Request</button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3.5: DEPOSIT COLLECTION (Strike Accounts Only) */}
        {step === 3.5 && depositData && (
          <div className={styles.formSection}>
            <div className={styles.actionWarning} style={{marginBottom: '2rem'}}>
              <AlertTriangle size={24} style={{ color: '#fbbf24', flexShrink: 0, marginTop: '2px' }} />
              <div style={{flex: 1}}>
                <h3 style={{margin: '0 0 4px', color: '#fbbf24', fontSize: '16px'}}>Security Deposit Required</h3>
                <p style={{margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5}}>
                  Because your account currently has active strikes, a standard security deposit of <strong>{depositData.totalAmountINR}</strong> is required before this order can be processed by our lab.
                </p>
                {depositData.depositResult?.source === 'wallet' && depositData.depositResult?.collected ? (
                  <div style={{display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontSize: '14px', fontWeight: 500}}>
                    <CheckCircle2 size={18} />
                    Deposit was automatically deducted from your Hesyra Wallet.
                  </div>
                ) : (
                  <p style={{margin: '0', fontSize: '13px', color: 'var(--brand-bioceramic)'}}>
                    Please click the button below to pay the deposit. Your order will remain drafted until payment is completed.
                  </p>
                )}
              </div>
            </div>

            <div className={styles.formActionsSpaceBetween}>
              <span style={{fontSize: '13px', color: 'var(--text-tertiary)'}}>Order ID: {depositData.id}</span>
              <div style={{display: 'flex', gap: '12px'}}>
                {depositData.depositResult?.collected ? (
                  <button className={styles.btnPrimary} onClick={() => {
                    setSubmittedId(depositData.id);
                    setStep(4);
                  }}>
                    Continue <ChevronLeft size={16} style={{transform: 'rotate(180deg)'}} />
                  </button>
                ) : (
                  <button className={styles.btnWarningOutline} onClick={() => {
                    // Open Razorpay link
                    if (depositData.depositResult?.paymentLink?.linkUrl) {
                      window.open(depositData.depositResult.paymentLink.linkUrl, '_blank');
                    }
                    // For local dev without webhooks, we allow them to proceed after simulating
                    // In a real app, webhooks would auto-confirm, and we might poll the status here
                    setTimeout(() => {
                      setSubmittedId(depositData.id);
                      setStep(4);
                    }, 1000);
                  }}>
                    Pay Deposit via Razorpay
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: SUCCESS */}
        {step === 4 && (
          <div className={styles.successSection}>
            <CheckCircle2 size={80} className={styles.successIcon} />
            <h2>Rx Submitted Successfully!</h2>
            <p>Your case for <strong>{formData.patientName}</strong> has been received and is now live on your dashboard.</p>
            <div className={styles.trackingBox}>
              <span className={styles.trackingLabel}>Tracking ID</span>
              <span className={styles.trackingCode}>{submittedId}</span>
            </div>
            <div style={{display: 'flex', gap: '1rem'}}>
              <button className={styles.btnOutline} onClick={() => navigate(`/case/${submittedId}`)}>View Case</button>
              <button className={styles.btnPrimary} onClick={() => navigate('/')}>Return to Dashboard</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NewCase;
