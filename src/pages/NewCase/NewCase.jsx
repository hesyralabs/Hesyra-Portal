import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { UploadCloud, FileType, CheckCircle2, ChevronLeft, Droplet, Layers, Activity, Crosshair, AlertTriangle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { useOnboarding } from '../../context/OnboardingContext';
import DragDropZone from '../../components/UI/DragDropZone';
import CoachTour from '../../components/Onboarding/CoachTour';
import styles from './NewCase.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const CASE_TYPES = [
  { id: 'crown_bridge', name: 'Crowns & Bridges', icon: Droplet, desc: 'Printed crowns, bridges & temporaries' },
  { id: 'veneer', name: 'Veneers', icon: Droplet, desc: 'Porcelain & ceramic dental veneers' },
  { id: 'aligner', name: 'Clear Aligners', icon: Layers, desc: 'Orthodontic aligner treatments' },
  { id: 'retainer', name: 'Retainers', icon: Droplet, desc: 'Essix retainers, Hawley' },
  { id: 'surgical_guide', name: 'Surgical Guides', icon: Crosshair, desc: 'Implant planning & drill guides' },
  { id: 'splint', name: 'Splints & Nightguards', icon: Activity, desc: 'Occlusal guards, TMJ splints' },
  { id: 'denture', name: 'Dentures', icon: Layers, desc: 'Full & partial dentures' }
];

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
    files: []
  });
  const [catalogMaterials, setCatalogMaterials] = useState([]);
  const [shades, setShades] = useState([]);
  const [presets, setPresets] = useState([]);

  useEffect(() => {
    if (user?.id) {
      const saved = localStorage.getItem(`hesyra_presets_${user.id}`);
      if (saved) setPresets(JSON.parse(saved));
    }
  }, [user]);

  // Fetch shades palette on mount
  useEffect(() => {
    const token = sessionStorage.getItem('hesyra_token');
    fetch(`${API}/api/catalog/shades`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setShades).catch(() => {});
  }, []);

  // Fetch materials when caseType changes
  useEffect(() => {
    if (!formData.caseType) { setCatalogMaterials([]); return; }
    // Reset SKU-related fields when case type changes to prevent stale selections
    setFormData(prev => ({ ...prev, materialSkuId: null, material: '', finishingTier: 'standard', referencePhoto: null }));
    const token = sessionStorage.getItem('hesyra_token');
    fetch(`${API}/api/catalog/materials?caseType=${formData.caseType}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(data => {
        setCatalogMaterials(Array.isArray(data) ? data : []);
        // Auto-select first material
        if (data.length > 0) {
          setFormData(prev => ({ ...prev, materialSkuId: data[0].id, material: data[0].displayName }));
        }
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

  const validateStep2 = () => {
    const newErrors = {};
    if (!formData.patientName.trim()) newErrors.patientName = 'Patient reference is required';
    
    if (['crown_bridge', 'retainer', 'splint', 'denture', 'veneer'].includes(formData.caseType) && !formData.specificType) {
      newErrors.specificType = 'Please select the specific type from the dropdown';
    }

    if ((formData.caseType === 'crown_bridge' || formData.caseType === 'veneer' || formData.caseType === 'surgical_guide') && formData.toothNumbers.length === 0) {
      newErrors.toothNumbers = 'Please select at least one tooth for this case.';
    }

    if (formData.finishingTier === 'premium' && !formData.referencePhoto) {
      newErrors.referencePhoto = 'Signature Match requires a reference photo of adjacent teeth.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 2 && !validateStep2()) {
      showToast('Please complete all required fields.', 'error');
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
    
    // Global Submission Validation
    if (formData.files.length === 0) {
      showToast('Please upload at least one digital scan or CBCT file before submitting your case.', 'error');
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

      <div className={styles.stepIndicator}>
        <div className={`${styles.step} ${step >= 1 ? styles.activeStep : ''}`}>1. Case Type</div>
        <div className={styles.stepLine} />
        <div className={`${styles.step} ${step >= 2 ? styles.activeStep : ''}`}>2. Prescription</div>
        <div className={styles.stepLine} />
        <div className={`${styles.step} ${step >= 3 ? styles.activeStep : ''}`}>3. Scans</div>
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
            <h2 className={styles.sectionTitle}>What type of case are you submitting?</h2>
            <div className={styles.caseTypeGrid} data-tour-target="sku">
              {CASE_TYPES.map((type) => {
                const Icon = type.icon;
                const isSelected = formData.caseType === type.id;
                return (
                  <button key={type.id}
                    className={`${styles.typeCard} ${isSelected ? styles.typeCardSelected : ''}`}
                    onClick={() => setFormData({...formData, caseType: type.id, specificType: formData.caseType === type.id ? formData.specificType : ''})}>
                    <Icon size={32} className={styles.typeIcon} />
                    <h3>{type.name}</h3>
                    <p>{type.desc}</p>
                  </button>
                )
              })}
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
            <h2 className={styles.sectionTitle}>
              {CASE_TYPES.find(t => t.id === formData.caseType)?.name} Prescription
            </h2>

            <div className={styles.inputGroup} data-tour-target="patient">
              <label className={errors.patientName ? styles.labelError : ''}>Patient Reference / Name</label>
              <input type="text" placeholder="e.g. John Doe - JD104"
                className={errors.patientName ? styles.inputError : ''}
                value={formData.patientName}
                onChange={(e) => {
                  setFormData({...formData, patientName: e.target.value});
                  if (errors.patientName) setErrors({...errors, patientName: null});
                }} />
              {errors.patientName && <span className={styles.errorText}>{errors.patientName}</span>}
            </div>

            {formData.caseType === 'crown_bridge' && (
              <div className={styles.inputGroup}>
                <label className={errors.specificType ? styles.labelError : ''}>Restoration Type</label>
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
                  Select Target Teeth (FDI Grouping)
                  {errors.toothNumbers && <span className={styles.errorText} style={{marginLeft: '8px', display: 'inline-block'}}>- {errors.toothNumbers}</span>}
                </label>
                <div className={styles.archContainer}>
                  <div className={styles.archRow}>
                    {upperTeeth.map(num => {
                      const isSelected = formData.toothNumbers.includes(num);
                      const isSuggested = suggestedTeeth.includes(num);
                      return (
                        <button key={num} onClick={() => toggleTooth(num)}
                          className={`${styles.toothBtn} ${isSelected ? styles.toothSelected : ''} ${isSuggested && !isSelected ? styles.toothSuggested : ''}`}>
                          {num}
                        </button>
                      );
                    })}
                  </div>
                  <div className={styles.archDivider}></div>
                  <div className={styles.archRow}>
                    {lowerTeeth.map(num => {
                      const isSelected = formData.toothNumbers.includes(num);
                      const isSuggested = suggestedTeeth.includes(num);
                      return (
                        <button key={num} onClick={() => toggleTooth(num)}
                          className={`${styles.toothBtn} ${isSelected ? styles.toothSelected : ''} ${isSuggested && !isSelected ? styles.toothSuggested : ''}`}>
                          {num}
                        </button>
                      );
                    })}
                  </div>
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

            {/* ─── Dynamic Material Picker (from catalog) ─── */}
            {catalogMaterials.length > 0 && (
              <div className={styles.inputGroup}>
                <label>Material</label>
                <div className={styles.materialGrid}>
                  {catalogMaterials.map(m => {
                    const isSelected = formData.materialSkuId === m.id;
                    return (
                      <button key={m.id} type="button"
                        className={`${styles.materialCard} ${isSelected ? styles.materialCardSelected : ''}`}
                        onClick={() => setFormData({...formData, materialSkuId: m.id, material: m.displayName, shade: m.shadeApplicable ? formData.shade : ''})}>
                        <span className={styles.materialCategory}>{m.category}</span>
                        <span className={styles.materialName}>{m.displayName}</span>
                        {m.finishingTiers?.includes('premium') && <span className={styles.premiumBadge}>✨ Signature Match</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

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
                      <strong>✨ Signature Match</strong>
                      <span>Hand-stained characterization matched to your patient's teeth</span>
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
              return (selMat?.shadeApplicable !== false && ['crown_bridge','veneer','denture'].includes(formData.caseType)) ? (
                <div className={styles.inputGroup} data-tour-target="shade">
                  <label>Target Shade (VITA Classical)</label>
                  <div className={styles.shadeGrid}>
                    {(shades.length > 0 ? shades : [{id:'A1',hex:'#f5e6c8'},{id:'A2',hex:'#ecd9b0'},{id:'A3',hex:'#dcc48e'},{id:'B1',hex:'#f0e4c6'},{id:'BL1',hex:'#faf6ee'}]).map(s => (
                      <button key={s.id} type="button"
                        className={`${styles.shadeSwatch} ${formData.shade === s.id ? styles.shadeSelected : ''}`}
                        style={{'--swatch-color': s.hex}}
                        onClick={() => setFormData({...formData, shade: s.id})}
                        title={s.name || s.id}>
                        <span className={styles.swatchColor} />
                        <span className={styles.swatchLabel}>{s.id}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null;
            })()}

            {formData.caseType === 'surgical_guide' && (
              <div className={styles.inputGroup}>
                <label>Implant System</label>
                <select value={formData.implantSystem} onChange={(e) => setFormData({...formData, implantSystem: e.target.value})}>
                  <option value="">Select System...</option>
                  <option>Straumann Bone Level</option>
                  <option>Nobel Biocare Active</option>
                  <option>Zimmer Biomet TSV</option>
                  <option>BioHorizons Tapered</option>
                </select>
              </div>
            )}

            <div className={styles.inputGroup} data-tour-target="notes">
              <label>Special Instructions</label>
              <textarea rows="4"
                placeholder={
                  formData.caseType === 'aligner' ? "Specify IPR limits, attachment preferences, and main movement goals..." :
                  formData.caseType === 'surgical_guide' ? "Specify sleeve preferences and depth..." :
                  "Any special design requests, margin preferences, or occlusion details..."
                }
                value={formData.instructions}
                onChange={(e) => setFormData({...formData, instructions: e.target.value})}></textarea>
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
        )}

        {/* STEP 3: UPLOADS */}
        {step === 3 && (
          <div className={styles.formSection}>
            <h2 className={styles.sectionTitle}>Upload Digital Scans</h2>
            <div data-tour-target="scan">
            <p className={styles.helperText}>
              Upload upper, lower, and bite scans in STL, PLY, or OBJ format.
              {formData.caseType === 'surgical_guide' && <strong style={{color: 'var(--brand-bioceramic)', display: 'block', marginTop: '4px'}}>CBCT (.dcm or .zip) required for Surgical Guides.</strong>}
            </p>

            {formData.caseType === 'crown_bridge' && contiguousGroups.length > 1 ? (
              <div style={{display: 'flex', flexDirection: 'column', gap: '1.5rem'}}>
                {contiguousGroups.map((group, idx) => {
                  const prefix = `Tooth-${group.join('-')}_`;
                  const groupFiles = formData.files.filter(f => f.name.startsWith(prefix));
                  return (
                    <div key={idx} style={{background: 'rgba(0,0,0,0.15)', border: '1px solid var(--glass-border)', borderRadius: '12px', padding: '1rem'}}>
                      <h4 style={{marginBottom: '12px', color: 'var(--text-primary)', fontSize: '0.875rem', fontWeight: 500}}>
                        Upload Scans for {group.length > 1 ? 'Teeth' : 'Tooth'} {group.join(', ')}
                      </h4>
                      <DragDropZone 
                        files={groupFiles.map(f => {
                           return { ...f, name: f.name.replace(prefix, '') };
                        })}
                        onFilesAdded={(newFiles) => {
                          const renamedFiles = newFiles.map(f => new File([f], prefix + f.name, { type: f.type }));
                          setFormData(prev => ({ ...prev, files: [...prev.files, ...renamedFiles] }));
                        }}
                        onFileRemoved={(index) => {
                           const targetFile = groupFiles[index];
                           setFormData(prev => ({ ...prev, files: prev.files.filter(f => f !== targetFile) }));
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <DragDropZone 
                files={formData.files}
                onFilesAdded={(newFiles) => setFormData(prev => ({ ...prev, files: [...prev.files, ...newFiles] }))}
                onFileRemoved={(index) => setFormData(prev => ({ ...prev, files: prev.files.filter((_, i) => i !== index) }))}
              />
            )}

            </div>
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
