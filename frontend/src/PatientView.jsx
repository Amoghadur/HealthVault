import { useState, useEffect, useCallback, useRef } from "react";
import { ConsentStatus, ConsentDuration } from "./components/ConsentUI";
import { QRCodeSVG } from "qrcode.react";
import { ethers } from "ethers";
import AuditDashboard from "./components/AuditDashboard";
import { apiRequest } from "./lib/api";
import { walletContract, waitForSuccess, transactionError } from "./lib/blockchain";
import { StatusMessage } from "./components/ui";
import { DEFAULT_RECORD_FILTERS, recordCategory, searchRecords, validateDateRange } from "./lib/recordSearch";
import PillButton from "./components/common/PillButton";
import PillInput from "./components/common/PillInput";
import Modal from "./components/common/Modal";
import EmptyState from "./components/common/EmptyState";
import { calculateAge, formatShortAddress, DIABETES_OPTIONS } from "./lib/patientProfile";
import { getShareableRecords } from "./lib/consentUi";

// Returns human-readable relative time string like "3 min ago" or "2 h ago"
function formatRelativeTime(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - Date.parse(iso);
  if (isNaN(diffMs) || diffMs < 0) return '';
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

const CONTRACT_ADDRESS =
  import.meta.env.VITE_CONTRACT_ADDRESS || "0x6c1A4da70506164Aa34F1D1d376c35dA5834Cf39";

const CONTRACT_ABI = [
  "function grantAccess(address doctor) public",
  "function revokeAccess(address doctor) public",
  "function hasAccess(address patient, address doctor) public view returns (bool)",
  "function getMyRecord() public view returns (string memory)",
  "function uploadRecord(string memory ipfsHash) public"
];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const STATIC_RECORDS = [
  {
    id: "R001",
    type: "Blood Test Report",
    doctor: "Dr. Arjun Sharma",
    hospital: "Apollo Hospital, Bangalore",
    date: "12 Jan 2025",
    icon: "🩸",
    findings: "Haemoglobin: 13.5 g/dL • HbA1c: 7.2% • WBC: 7200 cells/mcL • Fasting Glucose: 142 mg/dL",
    status: "Review in 3 months",
    ipfs: "QmR001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1"
  },
  {
    id: "R002",
    type: "Prescription",
    doctor: "Dr. Arjun Sharma",
    hospital: "Apollo Hospital, Bangalore",
    date: "3 Feb 2025",
    icon: "💊",
    findings: "Metformin 500mg twice daily with meals • Vitamin D3 1000 IU once daily",
    status: "Active — 90 days",
    ipfs: "QmR002b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2"
  },
  {
    id: "R003",
    type: "Discharge Summary",
    doctor: "Dr. Suresh Mehta",
    hospital: "Fortis Hospital, Bangalore",
    date: "10 May 2025",
    icon: "🏥",
    findings: "Diagnosis: Unstable Angina • Treatment: IV Heparin, Nitroglycerin • Stable at discharge",
    status: "Follow up in 1 week",
    ipfs: "QmR003c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3"
  }
];

function PatientRecordViewer({ record }) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!record?.id) return;
    const controller = new AbortController();
    let objectUrl = null;

    const loadDoc = async () => {
      setLoading(true);
      setError("");
      setBlobUrl(null);

      const token = localStorage.getItem("healthvault_token");
      try {
        const res = await fetch(`${API_URL}/records/view/${encodeURIComponent(record.id)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          const msg = res.status === 401
            ? "Your session has expired. Sign out and reconnect."
            : res.status === 403
            ? "Access denied. Record access could not be confirmed."
            : res.status === 404
            ? "The record file could not be found on the server."
            : `Could not load record (${res.status}).`;
          throw new Error(msg);
        }
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err.message || "Failed to load document.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    const timer = setTimeout(loadDoc, 0);

    return () => {
      clearTimeout(timer);
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };
  }, [record?.id]);

  return (
    <div style={{ marginTop: "14px" }}>
      {error && <StatusMessage type="error">{error}</StatusMessage>}
      {loading && (
        <p role="status" style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
          Decrypting and loading original document…
        </p>
      )}
      {!loading && !error && blobUrl && (
        <iframe
          src={blobUrl}
          style={{ width: "100%", height: "580px", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-card-sm)", background: "#FFFFFF" }}
          title={record.fileName}
        />
      )}
    </div>
  );
}

function RecordChecklist({ records = [], selectedIds = [], onChange, disabled = false, contextMessage = null }) {
  const selectedCount = selectedIds.filter(id => records.some(r => r.id === id)).length;
  const allSelected = records.length > 0 && selectedCount === records.length;
  const noneSelected = selectedCount === 0;

  const handleSelectAll = () => {
    onChange(records.map(r => r.id));
  };

  const handleSelectNone = () => {
    onChange([]);
  };

  const handleToggle = (id) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter(item => item !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  if (records.length === 0) {
    return (
      <div
        className="glass-card"
        style={{
          padding: '16px 20px',
          borderRadius: 'var(--radius-inner)',
          background: 'var(--bg-surface-subtle)',
          border: '1px solid var(--border-subtle)',
          fontSize: '12px',
          color: 'var(--text-secondary)',
          textAlign: 'center'
        }}
      >
        {contextMessage || '📂 No patient clinical documents available to share with this provider.'}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "12px" }}>
        <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
          {selectedCount} of {records.length} records selected
        </span>
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled || allSelected}
            style={{
              background: "none",
              border: "none",
              color: "var(--primary-dark)",
              fontWeight: 600,
              fontSize: "12px",
              cursor: disabled || allSelected ? "not-allowed" : "pointer",
              opacity: disabled || allSelected ? 0.5 : 1
            }}
          >
            Select all
          </button>
          <span style={{ color: "var(--border-subtle)" }}>|</span>
          <button
            type="button"
            onClick={handleSelectNone}
            disabled={disabled || noneSelected}
            style={{
              background: "none",
              border: "none",
              color: "var(--primary-dark)",
              fontWeight: 600,
              fontSize: "12px",
              cursor: disabled || noneSelected ? "not-allowed" : "pointer",
              opacity: disabled || noneSelected ? 0.5 : 1
            }}
          >
            Select none
          </button>
        </div>
      </div>

      <div
        style={{
          maxHeight: "240px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          padding: "4px",
          borderRadius: "var(--radius-inner)",
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-surface-subtle)"
        }}
      >
        {records.map(record => {
          const isSelected = selectedIds.includes(record.id);
          const typeIcon = record.recordType === "prescription" ? "💊" : "📄";
          const formattedDate = record.uploadedAt
            ? new Date(record.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
            : "Unknown date";

          return (
            <label
              key={record.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                padding: "10px 14px",
                borderRadius: "var(--radius-inner)",
                background: isSelected ? "var(--primary-tint)" : "var(--bg-surface)",
                border: isSelected ? "1px solid var(--primary-light)" : "1px solid var(--border-subtle)",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "all var(--duration-fast) ease"
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={disabled}
                onChange={() => handleToggle(record.id)}
                style={{
                  accentColor: "var(--primary)",
                  width: "16px",
                  height: "16px",
                  cursor: disabled ? "not-allowed" : "pointer"
                }}
              />
              <span style={{ fontSize: "16px" }}>{typeIcon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {record.fileName}
                </div>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  {record.recordType || "unspecified"} · {formattedDate}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default function PatientView({ account, patientProfile, setPatientProfile, openProfileModal }) {
  const [recordFilters, setRecordFilters] = useState(DEFAULT_RECORD_FILTERS);
  const [recordError, setRecordError] = useState("");
  const [booking, setBooking] = useState(false);
  const [appointmentDoctor, setAppointmentDoctor] = useState("");
  const [feedback, setFeedback] = useState(null);
  const notify = (text, type = "error") => setFeedback({ text, type });
  const [activeTab, setActiveTab] = useState("records");
  const [doctorInput, setDoctorInput] = useState("");
  const [message, setMessage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [qrExpiry, setQrExpiry] = useState(null);
  const [qrUrl, setQrUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);
  const [qrConfig, setQrConfig] = useState({ configured: false, host: null, baseUrl: null, error: null });
  const [qrRevoking, setQrRevoking] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]);

  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState("");
  const requestsInFlightRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [selectedDuration, setSelectedDuration] = useState(15);
  const [requestDurations, setRequestDurations] = useState({});
  const [grantSelectedRecordIds, setGrantSelectedRecordIds] = useState([]);
  const [requestSelectedRecords, setRequestSelectedRecords] = useState({});
  const [managingGrant, setManagingGrant] = useState(null);
  const [managingRecordIds, setManagingRecordIds] = useState([]);
  const [manageSaving, setManageSaving] = useState(false);
  const [manageError, setManageError] = useState("");
  const [manageSuccess, setManageSuccess] = useState("");
  const [activeGrants, setActiveGrants] = useState([]);
  const [grantsState, setGrantsState] = useState("idle");
  const [checkResult, setCheckResult] = useState(null);
  const [expandedRecord, setExpandedRecord] = useState(null);
  const [editingQr, setEditingQr] = useState(false);
  const [uploadedRecords, setUploadedRecords] = useState([]);
  const [fetchingRecords, setFetchingRecords] = useState(false);
  const [viewingRecord, setViewingRecord] = useState(null);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [selectedPdfRecord, setSelectedPdfRecord] = useState(null);
  const [promptBannerDismissed, setPromptBannerDismissed] = useState(false);

  const displayName = patientProfile?.displayName || (account ? formatShortAddress(account) : "Patient");
  const patientAge = calculateAge(patientProfile?.dateOfBirth);

  useEffect(() => {
    if (!patientProfile) return;
    const promptedKey = `healthvault_profile_prompted_${account?.toLowerCase()}`;
    if (!patientProfile.displayName && !sessionStorage.getItem(promptedKey)) {
      sessionStorage.setItem(promptedKey, "true");
      if (openProfileModal) openProfileModal();
    }
  }, [patientProfile, account, openProfileModal]);

  const filteredRecords = searchRecords(uploadedRecords, recordFilters);
  const dateRangeError = validateDateRange(recordFilters);
  const doctorWallets = [...new Set(uploadedRecords.map(record => record.doctorAddress?.toLowerCase()).filter(Boolean))].sort();
  const setRecordFilter = (field, value) => setRecordFilters(previous => ({ ...previous, [field]: value }));

  if (viewingRecord !== null && !filteredRecords.some(record => record.id === viewingRecord)) {
    setViewingRecord(null);
  }

  const [appointments, setAppointments] = useState([]);
  const [apptLoading, setApptLoading] = useState(false);
  const [newAppt, setNewAppt] = useState({
    doctor: "Dr. Arjun Sharma — General Physician",
    date: "", time: "10:00 AM", reason: ""
  });
  const [apptMessage, setApptMessage] = useState(null);
  const [qrData, setQrData] = useState(() => ({
    bloodType: patientProfile?.bloodGroup || "O+",
    allergies: patientProfile?.allergiesStatus === "no_known_allergies"
      ? "No known allergies"
      : (Array.isArray(patientProfile?.allergies) && patientProfile.allergies.length > 0
          ? patientProfile.allergies.join(", ")
          : ""),
    medications: "Metformin 500mg, Vitamin D3 1000 IU",
    emergencyContact: [patientProfile?.emergencyContactName, patientProfile?.emergencyContactPhone].filter(Boolean).join(" — ") || "Emergency Contact Not Set"
  }));

  // Synchronize emergency QR payload with updated patient profile values
  useEffect(() => {
    if (!patientProfile) return;
    const timer = setTimeout(() => {
      setQrData(prev => ({
        ...prev,
        bloodType: patientProfile.bloodGroup || prev.bloodType,
        allergies: patientProfile.allergiesStatus === "no_known_allergies"
          ? "No known allergies"
          : (Array.isArray(patientProfile.allergies) && patientProfile.allergies.length > 0
              ? patientProfile.allergies.join(", ")
              : (patientProfile.allergiesStatus === "unknown" ? "" : prev.allergies)),
        emergencyContact: [patientProfile.emergencyContactName, patientProfile.emergencyContactPhone].filter(Boolean).join(" — ") || prev.emergencyContact,
      }));
    }, 0);
    return () => clearTimeout(timer);
  }, [patientProfile]);

  // Clinical profile inline edit state
  const [editingClinicalProfile, setEditingClinicalProfile] = useState(false);
  const [clinicalSaving, setClinicalSaving] = useState(false);
  const [clinicalForm, setClinicalForm] = useState({
    allergies: [],
    allergiesStatus: "unknown",
    diabetesStatus: "Unknown / Not provided",
  });
  const [newClinicalAllergy, setNewClinicalAllergy] = useState("");
  const [clinicalAllergyError, setClinicalAllergyError] = useState("");

  const startEditingClinical = () => {
    setClinicalForm({
      allergies: Array.isArray(patientProfile?.allergies) ? [...patientProfile.allergies] : [],
      allergiesStatus: patientProfile?.allergiesStatus || (Array.isArray(patientProfile?.allergies) && patientProfile.allergies.length > 0 ? "has_allergies" : "unknown"),
      diabetesStatus: patientProfile?.diabetesStatus || "Unknown / Not provided",
    });
    setNewClinicalAllergy("");
    setClinicalAllergyError("");
    setEditingClinicalProfile(true);
  };

  const handleAddClinicalAllergy = () => {
    const trimmed = newClinicalAllergy.trim();
    if (!trimmed) {
      setClinicalAllergyError("Please enter an allergy name.");
      return;
    }
    if (trimmed.length > 50) {
      setClinicalAllergyError("Allergy name must be at most 50 characters.");
      return;
    }
    if (clinicalForm.allergies.some(a => a.toLowerCase() === trimmed.toLowerCase())) {
      setClinicalAllergyError("This allergy is already listed.");
      return;
    }
    setClinicalForm(prev => ({
      ...prev,
      allergies: [...prev.allergies, trimmed],
      allergiesStatus: "has_allergies",
    }));
    setNewClinicalAllergy("");
    setClinicalAllergyError("");
  };

  const handleRemoveClinicalAllergy = (idxToRemove) => {
    setClinicalForm(prev => ({
      ...prev,
      allergies: prev.allergies.filter((_, i) => i !== idxToRemove),
    }));
  };

  const handleClinicalAllergyStatusChange = (status) => {
    setClinicalForm(prev => ({
      ...prev,
      allergiesStatus: status,
      allergies: (status === "no_known_allergies" || status === "unknown") ? [] : prev.allergies,
    }));
    setClinicalAllergyError("");
  };

  const handleSaveClinicalProfile = async () => {
    try {
      setClinicalSaving(true);
      const payload = {
        displayName: patientProfile?.displayName || displayName || "Patient",
        avatar: patientProfile?.avatar || "",
        phone: patientProfile?.phone || "",
        dateOfBirth: patientProfile?.dateOfBirth || "",
        bloodGroup: patientProfile?.bloodGroup || "",
        about: patientProfile?.about || "",
        emergencyContactName: patientProfile?.emergencyContactName || "",
        emergencyContactPhone: patientProfile?.emergencyContactPhone || "",
        showIdentityToDoctors: patientProfile?.showIdentityToDoctors !== false,
        allergies: clinicalForm.allergiesStatus === "has_allergies" ? clinicalForm.allergies : [],
        allergiesStatus: clinicalForm.allergiesStatus,
        diabetesStatus: clinicalForm.diabetesStatus,
      };

      const result = await apiRequest("/api/patient/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (result?.profile) {
        if (typeof setPatientProfile === "function") {
          setPatientProfile(result.profile);
        }
        setEditingClinicalProfile(false);
        notify("Clinical details saved successfully.", "success");
      }
    } catch (err) {
      notify("Failed to save clinical details: " + err.message);
    } finally {
      setClinicalSaving(false);
    }
  };

  const handleCancelClinicalProfile = () => {
    setEditingClinicalProfile(false);
    setClinicalAllergyError("");
  };

  const patientId = localStorage.getItem("healthvault_patient_id") || "Not available — reconnect your wallet";

  // ── Fetch active doctor grants ──
  const fetchGrants = useCallback(async () => {
    setGrantsState("checking");
    try {
      const data = await apiRequest("/consent/grants");
      if (!isMountedRef.current) return;
      setActiveGrants(data.grants || []);
      setGrantsState("ready");
    } catch {
      if (!isMountedRef.current) return;
      setGrantsState("verification-unavailable");
      setActiveGrants([]);
    }
  }, []);

  // ── Fetch pending requests ──
  const fetchRequests = useCallback(async () => {
    if (requestsInFlightRef.current) return;
    requestsInFlightRef.current = true;
    setRequestsLoading(true);
    try {
      const token = localStorage.getItem("healthvault_token");
      if (!token) {
        if (isMountedRef.current) {
          setPendingRequests([]);
          setRequestsLoaded(true);
          setRequestsError("");
        }
        return;
      }
      const res = await fetch(`${API_URL}/consent/requests?type=incoming`, {
        headers: { "Authorization": `Bearer ${token}` },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("Could not load access requests. Please retry.");
      const data = await res.json();
      if (!isMountedRef.current) return;
      const rawList = Array.isArray(data.requests) ? data.requests : [];
      const seen = new Set();
      const unique = [];
      for (const r of rawList) {
        if (r && r.id && !seen.has(String(r.id))) {
          seen.add(String(r.id));
          unique.push(r);
        }
      }
      setPendingRequests(unique);
      setRequestsLoaded(true);
      setRequestsError("");
    } catch (err) {
      if (!isMountedRef.current) return;
      setRequestsError(err.message || "Failed to load access requests.");
      setRequestsLoaded(true);
    } finally {
      requestsInFlightRef.current = false;
      if (isMountedRef.current) {
        setRequestsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveGrants(prev => {
        let hasExpiredTransition = false;
        const updated = prev.map(g => {
          const remaining = Math.max(0, Math.round((Date.parse(g.expiresAt) - Date.now()) / 1000));
          const newStatus = g.revokedAt ? "revoked" : (remaining <= 0 ? "expired" : "active");
          if (g.status === "active" && newStatus === "expired") {
            hasExpiredTransition = true;
          }
          return {
            ...g,
            remainingSeconds: remaining,
            status: newStatus
          };
        });
        if (hasExpiredTransition) {
          fetchGrants();
          fetchRequests();
        }
        return updated;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [fetchGrants, fetchRequests]);

  // Window focus & visibility change recovery
  useEffect(() => {
    if (!account) return;
    const handleFocus = () => {
      fetchRequests();
      fetchGrants();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        handleFocus();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [account, fetchRequests, fetchGrants]);

  // ── Fetch uploaded records ──
  const fetchUploadedRecords = useCallback(async () => {
    try {
      setFetchingRecords(true);
      const data = await apiRequest("/records/patient");
      setRecordError("");
      setUploadedRecords(data.records || []);
    } catch (err) {
      setRecordError(err.message);
    } finally {
      setFetchingRecords(false);
    }
  }, []);

  // ── Fetch appointments ──
  const fetchAppointments = useCallback(async () => {
    try {
      setApptLoading(true);
      const data = await apiRequest("/appointments/patient");
      setAppointments(data.appointments || []);
    } catch (err) {
      setApptMessage({ type: "error", text: err.message });
    } finally {
      setApptLoading(false);
    }
  }, []);

  useEffect(() => {
    if (account) {
      const initial = setTimeout(() => {
        fetchUploadedRecords();
        fetchAppointments();
        fetchRequests();
        fetchGrants();
      }, 0);
      const interval = setInterval(() => {
        fetchUploadedRecords();
        fetchAppointments();
        fetchRequests();
        fetchGrants();
      }, 10000);
      return () => {
        clearTimeout(initial);
        clearInterval(interval);
      };
    }
  }, [account, fetchUploadedRecords, fetchAppointments, fetchRequests, fetchGrants]);

  const getContract = () => walletContract(CONTRACT_ABI, account);

  const resolveDoctorAddress = async (input) => {
    const val = input.trim();
    if (!val) return "";
    if (val.startsWith("0x")) return ethers.isAddress(val) ? val : "";
    try {
      const token = localStorage.getItem("healthvault_token");
      const res = await fetch(`${API_URL}/auth/lookup/${val.toUpperCase()}`, {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      const data = await res.json();
      return data.address || "";
    } catch { return ""; }
  };

  // ── Grant access ──
  const grantAccess = async () => {
    if (!doctorInput) return notify("Enter doctor Patient ID or wallet address");
    try {
      setLoading(true);
      setMessage(null);
      setCheckResult(null);
      const addr = await resolveDoctorAddress(doctorInput);
      if (!addr) {
        setMessage({ type: "error", text: "Could not find doctor with that ID or address." });
        return;
      }
      setMessage({ type: "info", text: "Confirm the access grant in MetaMask. No access has been confirmed yet." });
      const contract = await getContract();
      const tx = await contract.grantAccess(addr);
      setMessage({ type: "info", text: "Transaction submitted — waiting for blockchain confirmation..." });
      await waitForSuccess(tx);

      // Persist patient-authorized expiry grant and selected records in backend
      setMessage({ type: "info", text: "Transaction confirmed. Saving the temporary access duration…" });
      const recordsToFilter = (typeof uploadedRecords !== "undefined" && Array.isArray(uploadedRecords)) ? uploadedRecords : [];
      const shareable = (typeof getShareableRecords === "function") ? getShareableRecords(recordsToFilter, addr) : recordsToFilter;
      const shareableIds = new Set(shareable.map(r => String(r.id)));
      const rawGrantIds = (typeof grantSelectedRecordIds !== "undefined" && Array.isArray(grantSelectedRecordIds)) ? grantSelectedRecordIds : [];
      const cleanGrantIds = rawGrantIds.filter(id => shareableIds.has(String(id)));
      const { grant, recordIds: savedRecordIds } = await apiRequest("/consent/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorAddress: addr,
          durationMinutes: selectedDuration,
          ...(cleanGrantIds.length ? { recordIds: cleanGrantIds } : {})
        }),
      });

      // Wait 2 seconds then verify on chain
      await new Promise(r => setTimeout(r, 2000));
      const verifyProvider = new ethers.BrowserProvider(window.ethereum);
      const verifyContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, verifyProvider);
      const nowHasAccess = await verifyContract.hasAccess(account, addr);

      if (!nowHasAccess) throw new Error("Transaction confirmed but access is not currently active. Check again.");
      setMessage({
        type: "success",
        text: `✅ Access granted to ${addr.slice(0, 10)}... for ${selectedDuration} minutes (${(savedRecordIds || cleanGrantIds).length} records shared).\nTransaction confirmed on blockchain.`
      });
      setDoctorInput("");
      if (typeof setGrantSelectedRecordIds === "function") setGrantSelectedRecordIds([]);
      setCheckResult({ address: addr, hasAccess: nowHasAccess, status: "active", expiresAt: grant?.expiresAt, durationMinutes: selectedDuration });
      if (typeof fetchGrants === "function") fetchGrants();
      if (typeof fetchRequests === "function") fetchRequests();
    } catch (err) {
      setMessage({ type: "error", text: transactionError(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Save changes to shared records allow-list ──
  const saveSharedRecords = async () => {
    if (!managingGrant) return;
    setManageSaving(true);
    setManageError("");
    setManageSuccess("");
    const recordsToFilter = (typeof uploadedRecords !== "undefined" && Array.isArray(uploadedRecords)) ? uploadedRecords : [];
    const shareable = (typeof getShareableRecords === "function") ? getShareableRecords(recordsToFilter, managingGrant.doctorAddress) : recordsToFilter;
    const shareableIds = new Set(shareable.map(r => String(r.id)));
    const rawManagingIds = (typeof managingRecordIds !== "undefined" && Array.isArray(managingRecordIds)) ? managingRecordIds : [];
    const cleanRecordIds = rawManagingIds.filter(id => shareableIds.has(String(id)));
    try {
      const data = await apiRequest(`/consent/allowlist/${managingGrant.doctorAddress}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordIds: cleanRecordIds })
      });
      setManageSuccess(`Successfully updated shared records (${data.recordIds.length} shared).`);
      setActiveGrants(prev => prev.map(g => {
        if (g.doctorAddress.toLowerCase() === managingGrant.doctorAddress.toLowerCase()) {
          return {
            ...g,
            sharedRecordIds: data.recordIds,
            sharedRecordCount: data.recordIds.length
          };
        }
        return g;
      }));
      setTimeout(() => {
        setManagingGrant(null);
        setManageSuccess("");
      }, 1000);
    } catch (err) {
      setManageError(err.message || "Failed to update shared records.");
    } finally {
      setManageSaving(false);
    }
  };

  // ── Revoke access ──
  const revokeAccess = async (targetDoctor) => {
    const input = targetDoctor || doctorInput;
    if (!input) return notify("Enter doctor Patient ID or wallet address");
    try {
      setLoading(true);
      setMessage(null);
      setCheckResult(null);
      const addr = await resolveDoctorAddress(input);
      if (!addr) {
        setMessage({ type: "error", text: "Could not find doctor with that ID or address." });
        return;
      }
      if (!window.confirm(`Revoke access for this doctor?\n\n${addr}\n\nThis requires a MetaMask transaction. After confirmation, this doctor will need a new grant to access your records.`)) return;
      setMessage({ type: "info", text: "Confirm revocation in MetaMask. Access is not yet revoked." });
      const contract = await getContract();
      const tx = await contract.revokeAccess(addr);
      setMessage({ type: "info", text: "Transaction submitted — waiting for blockchain confirmation..." });
      await waitForSuccess(tx);

      let syncFailed = false;
      setMessage({ type: "info", text: "Transaction confirmed. Updating access status…" });
      try {
        await apiRequest("/consent/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doctorAddress: addr }),
        });
      } catch (err) {
        syncFailed = true;
        console.error("Revoke sync error:", err);
      }

      // Wait 2 seconds then verify on chain
      await new Promise(r => setTimeout(r, 2000));
      const verifyProvider = new ethers.BrowserProvider(window.ethereum);
      const verifyContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, verifyProvider);
      const stillHasAccess = await verifyContract.hasAccess(account, addr);

      setMessage({
        type: stillHasAccess || syncFailed ? "error" : "success",
        text: stillHasAccess
          ? "⚠️ Transaction submitted but access still shows on chain. Please check again in a few seconds."
          : syncFailed ? "Revocation confirmed on-chain, but the dashboard could not sync. Refresh grants and check current access before retrying."
          : `✅ Access revoked from ${addr.slice(0, 10)}...\nTransaction confirmed on blockchain.`
      });
      if (!targetDoctor) setDoctorInput("");
      setCheckResult({ address: addr, hasAccess: stillHasAccess, status: stillHasAccess ? "active" : "revoked" });
      if (typeof fetchGrants === "function") fetchGrants();
      if (typeof fetchRequests === "function") fetchRequests();
    } catch (err) {
      setMessage({ type: "error", text: transactionError(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Check access — uses MetaMask directly for real-time result ──
  const checkAccess = async (targetDoctor) => {
    const input = targetDoctor || doctorInput;
    if (!input) return notify("Enter doctor Patient ID or wallet address");
    try {
      setLoading(true);
      setMessage(null);
      setCheckResult({ status: "checking" });
      const addr = await resolveDoctorAddress(input);
      if (!addr) {
        setCheckResult(null);
        setMessage({ type: "error", text: "Could not find doctor." });
        return;
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
      const hasOnChain = await contract.hasAccess(account, addr);

      let backendStatus = null;
      try {
        backendStatus = await apiRequest(`/consent/status/${addr}`);
      } catch (err) {
        backendStatus = { status: "verification-unavailable", error: err.message };
      }

      setCheckResult({
        address: addr,
        hasAccess: Boolean(hasOnChain && backendStatus?.hasAccess),
        onChainAccess: hasOnChain,
        status: backendStatus?.status || (hasOnChain ? "active" : "revoked"),
        expiresAt: backendStatus?.expiresAt,
        remainingSeconds: backendStatus?.remainingSeconds
      });
    } catch (err) {
      setCheckResult({ status: "verification-unavailable" });
      setMessage({ type: "error", text: transactionError(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Respond to request ──
  const respondToRequest = async (requestId, action, doctorAddr) => {
    try {
      setLoading(true);
      const token = localStorage.getItem("healthvault_token");
      const durationMinutes = (typeof requestDurations !== "undefined" && requestDurations?.[requestId]) || 15;
      const recordsToFilter = (typeof uploadedRecords !== "undefined" && Array.isArray(uploadedRecords)) ? uploadedRecords : [];
      const shareable = (typeof getShareableRecords === "function") ? getShareableRecords(recordsToFilter, doctorAddr) : recordsToFilter;
      const shareableIds = new Set(shareable.map(r => String(r.id)));
      const rawRecordIds = (typeof requestSelectedRecords !== "undefined" && requestSelectedRecords?.[requestId]) || [];
      const recordIds = rawRecordIds.filter(id => shareableIds.has(String(id)));
      if (action === "accept") {
        setMessage({ type: "info", text: "Confirm the access grant in MetaMask. No access has been confirmed yet." });
        const contract = await getContract();
        const tx = await contract.grantAccess(doctorAddr);
        setMessage({ type: "info", text: "Transaction submitted — waiting for blockchain confirmation…" });
        await waitForSuccess(tx);
        setMessage({ type: "info", text: "Transaction confirmed. Saving the temporary access duration…" });
      } else {
        setMessage({ type: "info", text: "Declining request…" });
      }
      await apiRequest("/consent/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          requestId,
          action,
          durationMinutes,
          ...(recordIds.length ? { recordIds } : {})
        })
      });
      setMessage({ type: "success", text: action === "accept"
        ? `Access granted for ${durationMinutes} minutes (${recordIds.length} records shared). Transaction confirmed.`
        : "Request declined." });
      if (typeof setPendingRequests === "function") setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      if (typeof setRequestSelectedRecords === "function") {
        setRequestSelectedRecords(prev => {
          const copy = { ...prev };
          delete copy[requestId];
          return copy;
        });
      }
      if (typeof fetchGrants === "function") fetchGrants();
      if (typeof fetchRequests === "function") fetchRequests();
    } catch (err) {
      setMessage({ type: "error", text: transactionError(err) });
    } finally {
      setLoading(false);
    }
  };

  // ── Delete uploaded record ──
  const deleteRecord = async (recordId, fileName) => {
    if (!confirm(`Delete "${fileName}" permanently? This cannot be undone.`)) return;
    try {
      const token = localStorage.getItem("healthvault_token");
      const res = await fetch(`${API_URL}/records/${recordId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setUploadedRecords(prev => prev.filter(r => r.id !== recordId));
        if (viewingRecord === recordId) setViewingRecord(null);
      } else {
        notify("Could not delete: " + data.error);
      }
    } catch (err) {
      notify("Error: " + err.message);
    }
  };

  // ── Fetch Emergency QR status and active token ──
  const fetchQrStatus = useCallback(async () => {
    try {
      const [configData, activeData] = await Promise.all([
        apiRequest("/consent/qr/config").catch(() => ({ configured: false })),
        apiRequest("/consent/qr/active").catch(() => ({ hasActive: false }))
      ]);
      if (!isMountedRef.current) return;
      if (configData) {
        setQrConfig(configData);
      }
      if (activeData?.hasActive && activeData.scanUrl) {
        setQrUrl(activeData.scanUrl);
        setQrExpiry(activeData.expiryTime || (activeData.expiry ? new Date(activeData.expiry).toLocaleTimeString() : null));
        if (activeData.data) {
          setQrData(prev => ({
            ...prev,
            bloodType: activeData.data.bloodType || prev.bloodType,
            allergies: Array.isArray(activeData.data.allergies) ? activeData.data.allergies.join(", ") : (activeData.data.allergies || prev.allergies),
            medications: Array.isArray(activeData.data.medications) ? activeData.data.medications.join(", ") : (activeData.data.medications || prev.medications),
            emergencyContact: activeData.data.emergencyContact || prev.emergencyContact
          }));
        }
      } else {
        setQrUrl("");
        setQrExpiry(null);
      }
    } catch {
      // ignore
    }
  }, [setQrData]);

  useEffect(() => {
    if (activeTab === "qr") {
      const timer = setTimeout(() => {
        fetchQrStatus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [activeTab, fetchQrStatus]);

  // ── Generate QR ──
  const generateQR = async () => {
    try {
      setQrLoading(true);
      const token = localStorage.getItem("healthvault_token");
      const res = await fetch(`${API_URL}/consent/qr/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          patientData: {
            name: displayName,
            age: patientAge || 34,
            bloodType: qrData.bloodType,
            allergies: (qrData.allergies && qrData.allergies.trim())
              ? qrData.allergies.split(",").map(a => a.trim()).filter(Boolean)
              : (patientProfile?.allergiesStatus === "no_known_allergies"
                  ? ["No known allergies"]
                  : (Array.isArray(patientProfile?.allergies) ? patientProfile.allergies : [])),
            medications: qrData.medications.split(",").map(m => m.trim()).filter(Boolean),
            conditions: (patientProfile?.diabetesStatus && patientProfile.diabetesStatus !== "No diabetes" && patientProfile.diabetesStatus !== "Unknown / Not provided")
              ? [patientProfile.diabetesStatus]
              : [],
            emergencyContact: qrData.emergencyContact
          }
        })
      });
      const data = await res.json();
      if (data.success) {
        setQrUrl(data.scanUrl);
        setQrExpiry(data.expiryTime);
        setQrVisible(true);
        setEditingQr(false);
        if (data.publicHost) {
          setQrConfig(prev => ({ ...prev, configured: true, host: data.publicHost }));
        }
      } else {
        notify("Could not generate QR: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      notify("Error: " + err.message);
    } finally {
      setQrLoading(false);
    }
  };

  // ── Revoke QR ──
  const revokeQR = async () => {
    try {
      setQrRevoking(true);
      const token = localStorage.getItem("healthvault_token");
      const res = await fetch(`${API_URL}/consent/qr/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.success) {
        setQrUrl("");
        setQrExpiry(null);
        setQrVisible(false);
        notify("Emergency QR code revoked successfully.", "success");
      } else {
        notify("Could not revoke QR: " + (data.error || "Unknown error"));
      }
    } catch (err) {
      notify("Error: " + err.message);
    } finally {
      setQrRevoking(false);
    }
  };

  // ── Copy Link ──
  const handleCopyLink = async () => {
    if (!qrUrl) return;
    try {
      await navigator.clipboard.writeText(qrUrl);
      setCopyStatus("✓ Link copied!");
      setTimeout(() => setCopyStatus(""), 2500);
    } catch {
      notify("Failed to copy link to clipboard.");
    }
  };


  // ── Book appointment ──
  const bookAppointment = async () => {
    if (!newAppt.date || !newAppt.reason) {
      setApptMessage({ type: "error", text: "Please select a date and enter reason for visit." });
      return;
    }
    try {
      setBooking(true);
      const token = localStorage.getItem("healthvault_token");
      const doctorAddress = await resolveDoctorAddress(appointmentDoctor);
      if (!doctorAddress) throw new Error("Enter the intended doctor’s valid wallet address or HealthVault ID.");
      const doctorName = newAppt.doctor.split(" — ")[0];
      const res = await fetch(`${API_URL}/appointments/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          patientName: displayName, patientId,
          doctor: doctorName, doctorAddress, date: newAppt.date,
          time: newAppt.time || "10:00 AM", reason: newAppt.reason
        })
      });
      const data = await res.json();
      if (data.success) {
        setNewAppt({ doctor: "Dr. Arjun Sharma — General Physician", date: "", time: "10:00 AM", reason: "" });
        setApptMessage({ type: "success", text: `✅ Appointment request sent to ${doctorName}. Waiting for confirmation.` });
        fetchAppointments();
      } else {
        setApptMessage({ type: "error", text: data.error || "Could not book." });
      }
    } catch (err) {
      setApptMessage({ type: "error", text: "Error: " + err.message });
    } finally { setBooking(false); }
  };

  const tabs = [
    { id: "records", label: "My Records", icon: "📋" },
    { id: "access", label: pendingRequests.length > 0 ? `Access Control (${pendingRequests.length})` : "Access Control", icon: "🔐" },
    { id: "qr", label: "Emergency QR", icon: "🚨" },
    { id: "appointments", label: "Appointments", icon: "📅" },
    { id: "audit", label: "Audit Trail", icon: "📜" },
  ];

  const activeDoctorCount = activeGrants.filter(g => g.status === "active").length;

  return (
    <div className="role-view patient-view">
      <StatusMessage type={feedback?.type}>{feedback?.text}</StatusMessage>

      {/* First-login setup banner */}
      {!patientProfile?.displayName && !promptBannerDismissed && (
        <div
          className="glass-card spatial-layer-2"
          style={{
            padding: "16px 20px",
            borderRadius: "var(--radius-spatial-md)",
            background: "var(--primary-tint)",
            border: "1px solid var(--primary-mid)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "20px", color: "var(--primary)" }}>✦</span>
            <div>
              <strong style={{ fontSize: "14px", color: "var(--primary-dark)", display: "block" }}>
                Welcome to HealthVault! Set up your patient profile
              </strong>
              <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                Add your display name, avatar, and emergency contacts to personalize your sovereign health space.
              </span>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <PillButton size="sm" variant="primary" onClick={openProfileModal}>
              Complete profile
            </PillButton>
            <button
              type="button"
              onClick={() => setPromptBannerDismissed(true)}
              style={{
                background: "none",
                border: "none",
                fontSize: "16px",
                cursor: "pointer",
                color: "var(--text-secondary)",
                padding: "4px 8px",
              }}
              aria-label="Dismiss banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Patient Profile & Greeting Banner */}
      <div
        className="glass-card spatial-layer-2"
        style={{
          padding: "24px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "20px",
          marginBottom: "28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              overflow: "hidden",
              background: "var(--accent-gradient)",
              color: "#FFFFFF",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "18px",
              fontWeight: 700,
              boxShadow: "0 4px 14px rgba(35, 128, 113, 0.3)",
              cursor: openProfileModal ? "pointer" : "default",
            }}
            onClick={openProfileModal}
            title={openProfileModal ? "Click to edit profile" : undefined}
          >
            {patientProfile?.avatar ? (
              <img
                src={patientProfile.avatar}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              displayName.charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h2
                className="two-tone-heading"
                style={{ fontSize: "22px", margin: "0 0 4px 0" }}
              >
                Good morning,{" "}
                <span className="highlight-primary">{displayName}</span>
              </h2>
              {openProfileModal && (
                <button
                  type="button"
                  onClick={openProfileModal}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--primary-dark)",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                    padding: "0 4px",
                  }}
                >
                  Edit profile
                </button>
              )}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {patientAge ? `Age ${patientAge} · ` : ""}{patientProfile?.bloodGroup ? `Blood Type ${patientProfile.bloodGroup}` : "Blood Type not set"}{patientProfile?.diabetesStatus && patientProfile.diabetesStatus !== "Unknown / Not provided" ? ` · ${patientProfile.diabetesStatus}` : ""}{patientProfile?.allergiesStatus === "no_known_allergies" ? " · No known allergies" : (Array.isArray(patientProfile?.allergies) && patientProfile.allergies.length > 0 ? ` · Allergies: ${patientProfile.allergies.join(", ")}` : "")}{patientProfile?.about ? ` · ${patientProfile.about}` : ""}
            </div>
          </div>
        </div>

        {/* Patient ID Pill */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            background: "var(--bg-surface-subtle)",
            padding: "8px 16px",
            borderRadius: "var(--radius-pill)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
            HealthVault ID
          </span>
          <code style={{ fontSize: "12px", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--primary-dark)" }}>
            {patientId}
          </code>
        </div>
      </div>

      {/* Stats Row in Big Number Style */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        {[
          { label: "Total Uploads", value: String(uploadedRecords.length), detail: "Encrypted on server" },
          { label: "Active Grants", value: String(activeDoctorCount), detail: "Care providers with access" },
          { label: "Pending Requests", value: String(pendingRequests.length), detail: "Awaiting your signature" },
          { label: "Appointments", value: String(appointments.length), detail: "Scheduled consultations" },
        ].map((item, idx) => (
          <div
            key={idx}
            className="stat-card spatial-layer-2"
            style={{
              padding: "22px 20px",
            }}
          >
            <span className="stat-label">{item.label}</span>
            <div className="stat-value">{item.value}</div>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{item.detail}</span>
          </div>
        ))}
      </div>

      {/* Navigation Pill Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
      >
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === "access") {
                  fetchRequests();
                  fetchGrants();
                }
                if (tab.id === "appointments") fetchAppointments();
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 18px",
                borderRadius: "var(--radius-pill)",
                border: isActive
                  ? "1px solid var(--primary)"
                  : "1px solid var(--glass-l1-border)",
                background: isActive
                  ? "var(--primary-tint)"
                  : "var(--glass-l1-bg)",
                backdropFilter: "var(--glass-l1-blur)",
                WebkitBackdropFilter: "var(--glass-l1-blur)",
                boxShadow: isActive
                  ? "0 4px 14px rgba(35, 128, 113, 0.15)"
                  : "var(--shadow-sm)",
                color: isActive
                  ? "var(--primary-dark)"
                  : "var(--text-primary)",
                fontSize: "12px",
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                transition: "all var(--duration-fast) var(--ease-spring)",
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Panels */}
      <div
        className="panel spatial-panel spatial-layer-1"
        style={{
          padding: "32px",
        }}
      >
        {/* ── TAB 1: MY RECORDS ── */}
        {activeTab === "records" && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: "12px",
                marginBottom: "20px",
              }}
            >
              <div>
                <span className="section-label" style={{ marginBottom: "6px" }}>
                  CLINICAL REPOSITORY
                </span>
                <h3
                  className="two-tone-heading"
                  style={{ fontSize: "20px", margin: 0 }}
                >
                  Medical Records ·{" "}
                  <span className="highlight-primary">{displayName}</span>
                </h3>
                <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
                  Files are encrypted with AES-256-GCM. Authenticated doctors with valid consent can view decrypted records during active access windows.
                </p>
              </div>

              <PillButton
                size="sm"
                variant="outline"
                onClick={fetchUploadedRecords}
                disabled={fetchingRecords}
                icon={<span>🔄</span>}
              >
                {fetchingRecords ? "Refreshing…" : "Refresh records"}
              </PillButton>
            </div>

            <StatusMessage type="error">{recordError}</StatusMessage>

            {/* Filter Bar */}
            <div
              className="spatial-layer-1"
              style={{
                padding: "20px",
                borderRadius: "var(--radius-spatial-md)",
                marginBottom: "24px",
              }}
            >
              <div style={{ marginBottom: "14px" }}>
                <PillInput
                  placeholder="Search records by file name…"
                  value={recordFilters.query}
                  onChange={(e) => setRecordFilter("query", e.target.value)}
                  icon={<span>🔍</span>}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))",
                  gap: "12px",
                }}
              >
                <label className="field-label">
                  Record Category
                  <select
                    value={recordFilters.category}
                    onChange={(e) => setRecordFilter("category", e.target.value)}
                  >
                    <option value="">All categories</option>
                    <option value="prescription">Prescription</option>
                    <option value="report">Report</option>
                    <option value="unspecified">Unspecified</option>
                  </select>
                </label>

                <label className="field-label">
                  Uploader Wallet
                  <select
                    value={recordFilters.doctorAddress}
                    onChange={(e) => setRecordFilter("doctorAddress", e.target.value)}
                  >
                    <option value="">All uploader wallets</option>
                    {doctorWallets.map((wallet) => (
                      <option key={wallet} value={wallet}>
                        {wallet.slice(0, 10)}…{wallet.slice(-4)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  Uploaded From
                  <input
                    type="date"
                    value={recordFilters.dateFrom}
                    onChange={(e) => setRecordFilter("dateFrom", e.target.value)}
                  />
                </label>

                <label className="field-label">
                  Uploaded Through
                  <input
                    type="date"
                    value={recordFilters.dateTo}
                    onChange={(e) => setRecordFilter("dateTo", e.target.value)}
                  />
                </label>

                <label className="field-label">
                  Sort
                  <select
                    value={recordFilters.sort}
                    onChange={(e) => setRecordFilter("sort", e.target.value)}
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="title">Filename A–Z</option>
                  </select>
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: "14px",
                  fontSize: "12px",
                  color: "var(--text-tertiary)",
                }}
              >
                <span>Showing {filteredRecords.length} of {uploadedRecords.length} records.</span>
                <button
                  type="button"
                  onClick={() => setRecordFilters(DEFAULT_RECORD_FILTERS)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--primary-dark)",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                  }}
                >
                  Clear filters
                </button>
              </div>
              <StatusMessage type="error">{dateRangeError}</StatusMessage>
            </div>

            {/* Real Uploaded Records */}
            {uploadedRecords.length === 0 && !fetchingRecords && (
              <EmptyState
                icon="📁"
                title="No uploaded clinical records yet"
                description="When your care provider uploads prescriptions or lab summaries, they will appear here encrypted with AES-256-GCM."
              />
            )}

            {filteredRecords.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-tertiary)",
                    marginBottom: "4px",
                  }}
                >
                  SECURE STORAGE RECORDS
                </span>

                {filteredRecords.map((rec) => (
                  <div
                    key={rec.id}
                    className="glass-card spatial-layer-2"
                    style={{
                      borderRadius: "var(--radius-spatial-md)",
                      border: "1px solid var(--border-subtle)",
                      padding: "18px 22px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "16px",
                      background: "var(--bg-surface)",
                      transition: "transform var(--duration-fast) ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div
                        style={{
                          width: "42px",
                          height: "42px",
                          borderRadius: "12px",
                          background: "var(--primary-tint)",
                          color: "var(--primary-dark)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "18px",
                          flexShrink: 0,
                        }}
                      >
                        📄
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>
                            {rec.fileName}
                          </strong>
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "2px 8px",
                              borderRadius: "var(--radius-pill)",
                              background: "var(--status-success-bg)",
                              color: "var(--status-success-text)",
                              fontWeight: 600,
                              textTransform: "uppercase",
                            }}
                          >
                            AES-256 STORED
                          </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "3px" }}>
                          {rec.doctorName} · {new Date(rec.uploadedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {recordCategory(rec)}
                        </div>
                        <div style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--text-tertiary)", marginTop: "2px" }}>
                          IPFS Hash: {rec.ipfsHash}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "8px" }}>
                      <PillButton
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setSelectedPdfRecord(rec);
                          setPdfModalOpen(true);
                        }}
                      >
                        View Original PDF
                      </PillButton>
                      <button
                        type="button"
                        onClick={() => deleteRecord(rec.id, rec.fileName)}
                        style={{
                          width: "34px",
                          height: "34px",
                          borderRadius: "50%",
                          border: "1px solid var(--border-subtle)",
                          background: "transparent",
                          color: "var(--status-error-text)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "13px",
                        }}
                        aria-label={`Delete ${rec.fileName}`}
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Static Demonstration Records */}
            <div>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-tertiary)",
                  display: "block",
                  marginBottom: "12px",
                }}
              >
                DEMONSTRATION CLINICAL SAMPLES
              </span>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {STATIC_RECORDS.map((rec, i) => (
                  <div
                    key={i}
                    className="glass-card spatial-layer-2"
                    style={{
                      borderRadius: "var(--radius-spatial-md)",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--bg-surface-subtle)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      onClick={() => setExpandedRecord(expandedRecord === i ? null : i)}
                      style={{
                        padding: "16px 20px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <span style={{ fontSize: "22px" }}>{rec.icon}</span>
                        <div>
                          <strong style={{ fontSize: "14px", color: "var(--text-primary)" }}>{rec.type}</strong>
                          <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                            {rec.doctor} · {rec.hospital} · {rec.date}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: "12px", color: "var(--primary-dark)", fontWeight: 600 }}>
                        {expandedRecord === i ? "Hide ▲" : "Inspect ▼"}
                      </span>
                    </div>

                    {expandedRecord === i && (
                      <div
                        style={{
                          padding: "16px 20px",
                          borderTop: "1px solid var(--border-subtle)",
                          background: "var(--bg-surface)",
                          fontSize: "12px",
                          lineHeight: 1.6,
                        }}
                      >
                        <div style={{ marginBottom: "6px" }}>
                          <strong>Findings:</strong> {rec.findings}
                        </div>
                        <div style={{ marginBottom: "8px", color: "var(--text-secondary)" }}>
                          <strong>Clinical Status:</strong> {rec.status}
                        </div>
                        <code
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "11px",
                            padding: "4px 8px",
                            borderRadius: "6px",
                            background: "var(--bg-surface-subtle)",
                            color: "var(--primary-dark)",
                            display: "inline-block",
                          }}
                        >
                          IPFS: {rec.ipfs}
                        </code>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Clinical Medical Profile Card (Known Allergies & Diabetes Status) */}
            <div
              className="glass-card spatial-layer-2"
              style={{
                marginTop: "28px",
                padding: "24px",
                borderRadius: "var(--radius-spatial-lg)",
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-surface-subtle)",
              }}
            >
              {/* Header Row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "20px",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      color: "var(--primary-dark)",
                      display: "block",
                      marginBottom: "4px",
                    }}
                  >
                    Clinical Indicators & Alerts
                  </span>
                  <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "var(--text-primary)" }}>
                    Medical Profile Details
                  </h4>
                </div>

                {!editingClinicalProfile ? (
                  <PillButton
                    id="edit-clinical-details-btn"
                    size="sm"
                    variant="outline"
                    onClick={startEditingClinical}
                  >
                    ✏️ Edit Clinical Details
                  </PillButton>
                ) : (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <PillButton
                      size="sm"
                      variant="ghost"
                      onClick={handleCancelClinicalProfile}
                      disabled={clinicalSaving}
                    >
                      Cancel
                    </PillButton>
                    <PillButton
                      id="save-clinical-details-btn"
                      size="sm"
                      variant="primary"
                      onClick={handleSaveClinicalProfile}
                      disabled={clinicalSaving}
                    >
                      {clinicalSaving ? "Saving…" : "Save Changes"}
                    </PillButton>
                  </div>
                )}
              </div>

              {!editingClinicalProfile ? (
                /* ── VIEW MODE ── */
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
                  {/* Known Allergies Card */}
                  <div
                    style={{
                      padding: "16px 18px",
                      borderRadius: "var(--radius-spatial-md)",
                      background: patientProfile?.allergiesStatus === "has_allergies" && Array.isArray(patientProfile?.allergies) && patientProfile.allergies.length > 0
                        ? "var(--status-error-bg)"
                        : "var(--bg-surface)",
                      border: patientProfile?.allergiesStatus === "has_allergies" && Array.isArray(patientProfile?.allergies) && patientProfile.allergies.length > 0
                        ? "1px solid var(--status-error-border)"
                        : "1px solid var(--border-subtle)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <strong style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)" }}>
                        Known Allergies
                      </strong>
                      {patientProfile?.allergiesStatus === "has_allergies" && Array.isArray(patientProfile?.allergies) && patientProfile.allergies.length > 0 && (
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--status-error-text)" }}>
                          Physician Alert
                        </span>
                      )}
                    </div>

                    {patientProfile?.allergiesStatus === "has_allergies" && Array.isArray(patientProfile?.allergies) && patientProfile.allergies.length > 0 ? (
                      <div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "4px" }}>
                          {patientProfile.allergies.map((allergy, i) => (
                            <span
                              key={i}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                background: "#FFFFFF",
                                color: "var(--status-error-text)",
                                border: "1px solid var(--status-error-border)",
                                padding: "4px 10px",
                                borderRadius: "var(--radius-pill)",
                                fontSize: "12px",
                                fontWeight: 700,
                              }}
                            >
                              <span>⚠️</span>
                              <span>{allergy}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : patientProfile?.allergiesStatus === "no_known_allergies" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--status-success-text)" }}>
                        <span style={{ fontSize: "14px", fontWeight: 700 }}>✓</span>
                        <div>
                          <strong style={{ fontSize: "13px" }}>No known allergies</strong>
                          <span style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)" }}>
                            Explicitly verified: No known drug allergies (NKDA)
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)" }}>
                        <span style={{ fontSize: "14px" }}>ℹ️</span>
                        <div>
                          <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>Not provided</strong>
                          <span style={{ display: "block", fontSize: "11px" }}>
                            Allergy status has not been recorded
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Diabetes Status Card */}
                  <div
                    style={{
                      padding: "16px 18px",
                      borderRadius: "var(--radius-spatial-md)",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-subtle)",
                    }}
                  >
                    <div style={{ marginBottom: "8px" }}>
                      <strong style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-secondary)" }}>
                        Diabetes Status
                      </strong>
                    </div>

                    {patientProfile?.diabetesStatus && patientProfile.diabetesStatus !== "Unknown / Not provided" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "16px" }}>
                          {patientProfile.diabetesStatus === "No diabetes" ? "✓" : "🩸"}
                        </span>
                        <div>
                          <strong
                            style={{
                              fontSize: "13px",
                              color: patientProfile.diabetesStatus === "No diabetes"
                                ? "var(--status-success-text)"
                                : "var(--primary-dark)",
                            }}
                          >
                            {patientProfile.diabetesStatus}
                          </strong>
                          <span style={{ display: "block", fontSize: "11px", color: "var(--text-secondary)" }}>
                            {patientProfile.diabetesStatus === "No diabetes"
                              ? "Confirmed negative for diabetes"
                              : "Active diagnostic classification"}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-secondary)" }}>
                        <span style={{ fontSize: "14px" }}>ℹ️</span>
                        <div>
                          <strong style={{ fontSize: "13px", color: "var(--text-primary)" }}>Not provided</strong>
                          <span style={{ display: "block", fontSize: "11px" }}>
                            Diabetes status has not been recorded
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* ── INLINE EDIT MODE ── */
                <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                  {/* Diabetes Dropdown */}
                  <div className="pill-input-group">
                    <label
                      htmlFor="inline-diabetes-status"
                      style={{
                        display: "block",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--text-secondary)",
                        marginBottom: "6px",
                      }}
                    >
                      Diabetes Status
                    </label>
                    <select
                      id="inline-diabetes-status"
                      className="pill-input"
                      value={clinicalForm.diabetesStatus}
                      onChange={(e) => setClinicalForm(prev => ({ ...prev, diabetesStatus: e.target.value }))}
                      style={{ width: "100%", background: "var(--glass-l2-bg)" }}
                    >
                      {DIABETES_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Known Allergies Selector & Adder */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "var(--text-secondary)",
                        marginBottom: "8px",
                      }}
                    >
                      Known Allergies
                    </label>

                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "12px" }}>
                      {[
                        { value: "has_allergies", label: "I have known allergies" },
                        { value: "no_known_allergies", label: "No known allergies (NKDA)" },
                        { value: "unknown", label: "Unknown / Not provided" },
                      ].map((opt) => (
                        <label
                          key={opt.value}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "12px",
                            cursor: "pointer",
                            padding: "6px 12px",
                            borderRadius: "var(--radius-pill)",
                            background: clinicalForm.allergiesStatus === opt.value ? "var(--primary-tint)" : "var(--bg-surface)",
                            border: clinicalForm.allergiesStatus === opt.value ? "1px solid var(--primary-mid)" : "1px solid var(--border-subtle)",
                            color: clinicalForm.allergiesStatus === opt.value ? "var(--primary-dark)" : "var(--text-secondary)",
                            fontWeight: clinicalForm.allergiesStatus === opt.value ? 600 : 500,
                          }}
                        >
                          <input
                            type="radio"
                            name="inlineAllergiesStatus"
                            value={opt.value}
                            checked={clinicalForm.allergiesStatus === opt.value}
                            onChange={() => handleClinicalAllergyStatusChange(opt.value)}
                            style={{ accentColor: "var(--primary)" }}
                          />
                          <span>{opt.label}</span>
                        </label>
                      ))}
                    </div>

                    {clinicalForm.allergiesStatus === "has_allergies" && (
                      <div
                        style={{
                          background: "var(--bg-surface)",
                          padding: "14px",
                          borderRadius: "var(--radius-spatial-sm)",
                          border: "1px solid var(--border-subtle)",
                        }}
                      >
                        <div style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginBottom: "8px" }}>
                          <div style={{ flex: 1 }}>
                            <input
                              type="text"
                              id="inline-add-allergy"
                              className="pill-input"
                              value={newClinicalAllergy}
                              onChange={(e) => {
                                setNewClinicalAllergy(e.target.value);
                                if (clinicalAllergyError) setClinicalAllergyError("");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleAddClinicalAllergy();
                                }
                              }}
                              placeholder="Enter an allergy (e.g. Penicillin, Peanuts, Latex)"
                              maxLength={50}
                              style={{ width: "100%", fontSize: "12px", padding: "8px 14px" }}
                            />
                            {clinicalAllergyError && (
                              <p role="alert" style={{ margin: "4px 0 0 8px", fontSize: "11px", color: "var(--status-error-text)" }}>
                                {clinicalAllergyError}
                              </p>
                            )}
                          </div>
                          <PillButton
                            id="inline-add-allergy-btn"
                            type="button"
                            size="sm"
                            variant="primary"
                            onClick={handleAddClinicalAllergy}
                          >
                            + Add Allergy
                          </PillButton>
                        </div>

                        {clinicalForm.allergies.length > 0 ? (
                          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                            {clinicalForm.allergies.map((allergy, i) => (
                              <span
                                key={i}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                  background: "var(--status-error-bg)",
                                  color: "var(--status-error-text)",
                                  border: "1px solid var(--status-error-border)",
                                  padding: "4px 10px",
                                  borderRadius: "var(--radius-pill)",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                }}
                              >
                                <span>⚠️ {allergy}</span>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveClinicalAllergy(i)}
                                  aria-label={`Remove allergy ${allergy}`}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    color: "var(--status-error-text)",
                                    fontWeight: 700,
                                    padding: "0 2px",
                                    fontSize: "12px",
                                    lineHeight: 1,
                                  }}
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text-tertiary)", fontStyle: "italic" }}>
                            No allergies listed yet. Type an allergy above and click &ldquo;+ Add Allergy&rdquo;.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 2: ACCESS CONTROL ── */}
        {activeTab === "access" && (
          <div className="consent-panel">
            <span className="section-label" style={{ marginBottom: "6px" }}>
              ACCESS CONTROL PROTOCOL
            </span>
            <h3 className="two-tone-heading" style={{ fontSize: "20px", margin: "0 0 16px 0" }}>
              Manage Doctor <span className="highlight-primary">Permissions</span>
            </h3>

            {/* Requests Error Banner */}
            {requestsError && (
              <div style={{ marginBottom: "20px" }}>
                <StatusMessage type="error">{requestsError}</StatusMessage>
                <div style={{ marginTop: "8px" }}>
                  <PillButton size="sm" variant="outline" onClick={fetchRequests} disabled={requestsLoading}>
                    {requestsLoading ? "Retrying…" : "Retry Loading Requests"}
                  </PillButton>
                </div>
              </div>
            )}

            {/* Requests Loading Indicator */}
            {requestsLoading && pendingRequests.length === 0 && (
              <div
                className="glass-card spatial-layer-1"
                style={{ padding: "16px 20px", borderRadius: "var(--radius-spatial-md)", marginBottom: "20px", display: "flex", alignItems: "center", gap: "10px" }}
              >
                <span style={{ fontSize: "16px" }}>⏳</span>
                <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>Checking incoming care provider access requests…</span>
              </div>
            )}

            {/* Pending Requests Alert */}
            {pendingRequests.length > 0 ? (
              <div
                className="spatial-layer-1"
                style={{
                  background: "var(--primary-tint)",
                  border: "1px solid var(--primary-light)",
                  borderRadius: "var(--radius-spatial-lg)",
                  padding: "20px",
                  marginBottom: "24px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--primary-dark)" }}>
                    🔔 {pendingRequests.length} care provider{pendingRequests.length > 1 ? "s" : ""} requesting temporary access
                  </div>
                  <PillButton size="sm" variant="outline" onClick={fetchRequests} disabled={requestsLoading}>
                    {requestsLoading ? "Refreshing…" : "↻ Refresh Requests"}
                  </PillButton>
                </div>

                {pendingRequests.map((req) => {
                  const reqDoctorName = req.doctorName && !req.doctorName.startsWith('Wallet ')
                    ? req.doctorName
                    : (req.profile?.displayName || null);
                  const reqShortAddr = req.doctorAddress ? `${req.doctorAddress.slice(0, 6)}\u2026${req.doctorAddress.slice(-4)}` : '';
                  const reqRelTime = formatRelativeTime(req.requestedAt);
                  const reqExactTime = req.requestedAt ? new Date(req.requestedAt).toLocaleString() : '';
                  const doctorTitle = reqDoctorName || reqShortAddr || 'Care Provider';
                  const hasDoctorProfile = Boolean(reqDoctorName);
                  const doctorAvatar = req.profile?.avatar || req.doctorAvatar;
                  return (
                    <div
                      key={req.id}
                      className="glass-card spatial-layer-2"
                      style={{
                        padding: '18px',
                        borderRadius: 'var(--radius-spatial-md)',
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-subtle)',
                        marginBottom: '12px',
                      }}
                    >
                      {/* Doctor identity row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: '50%',
                            overflow: 'hidden',
                            background: 'var(--primary-dark)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '14px',
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {doctorAvatar ? (
                            <img
                              src={doctorAvatar}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            (doctorTitle || 'D').charAt(0).toUpperCase()
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ fontSize: '13px', color: 'var(--text-primary)', display: 'block' }}>
                            {doctorTitle}
                          </strong>
                          <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            {hasDoctorProfile ? (
                              <>
                                {reqShortAddr}
                                {req.profile?.specialty ? ` · ${req.profile.specialty}` : ''}
                                {req.profile?.affiliation ? ` (${req.profile.affiliation})` : ''}
                              </>
                            ) : (
                              'Care Provider (No profile configured)'
                            )}
                          </span>
                        </div>
                        {reqRelTime && (
                          <span
                            title={reqExactTime}
                            style={{ fontSize: '11px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', cursor: 'default' }}
                          >
                            Requested {reqRelTime}
                          </span>
                        )}
                      </div>

                      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px 0' }}>
                        Reason: {req.reason}
                      </p>

                      <ConsentDuration
                        value={requestDurations[req.id] || 15}
                        disabled={loading}
                        onChange={(minutes) => setRequestDurations((prev) => ({ ...prev, [req.id]: minutes }))}
                      />

                      <div style={{ marginTop: '14px', marginBottom: '14px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                          Select Records to Share:
                        </div>
                        <RecordChecklist
                          records={getShareableRecords(uploadedRecords, req.doctorAddress)}
                          selectedIds={requestSelectedRecords[req.id] || []}
                          onChange={(newIds) => setRequestSelectedRecords(prev => ({ ...prev, [req.id]: newIds }))}
                          disabled={loading}
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '10px', marginTop: '14px' }}>
                        <PillButton
                          size="sm"
                          variant="primary"
                          onClick={() => respondToRequest(req.id, 'accept', req.doctorAddress)}
                          disabled={loading}
                        >
                          Accept ({requestDurations[req.id] || 15}m)
                        </PillButton>
                        <PillButton
                          size="sm"
                          variant="outline"
                          onClick={() => respondToRequest(req.id, 'reject', req.doctorAddress)}
                          disabled={loading}
                        >
                          Decline
                        </PillButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : requestsLoaded && !requestsLoading && !requestsError ? (
              <div
                className="glass-card spatial-layer-1"
                style={{
                  background: "var(--bg-surface-subtle)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-spatial-md)",
                  padding: "20px",
                  marginBottom: "24px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "16px",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "20px" }}>🔒</span>
                  <div>
                    <strong style={{ fontSize: "13px", color: "var(--text-primary)", display: "block" }}>
                      No Pending Access Requests
                    </strong>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Requests from care providers will appear here when they request temporary access to your records.
                    </span>
                  </div>
                </div>
                <PillButton size="sm" variant="outline" onClick={fetchRequests} disabled={requestsLoading}>
                  {requestsLoading ? "Checking…" : "↻ Check Requests"}
                </PillButton>
              </div>
            ) : null}

            {/* Grant / Revoke Controls */}
            <div
              className="glass-card spatial-layer-1"
              style={{
                background: "var(--bg-surface-subtle)",
                borderRadius: "var(--radius-spatial-lg)",
                padding: "24px",
                border: "1px solid var(--border-subtle)",
                marginBottom: "28px",
              }}
            >
              <PillInput
                label="Care Provider Wallet or HealthVault ID"
                placeholder="HV-1002  or  0x89a3..."
                value={doctorInput}
                disabled={loading}
                onChange={(e) => {
                  setDoctorInput(e.target.value);
                  setCheckResult(null);
                  setMessage(null);
                }}
              />

              <div style={{ marginTop: "16px" }}>
                <ConsentDuration
                  value={selectedDuration}
                  onChange={setSelectedDuration}
                  disabled={loading}
                />
              </div>

              <div style={{ marginTop: "16px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px" }}>
                  Select Records to Share:
                </div>
                <RecordChecklist
                  records={getShareableRecords(uploadedRecords, doctorInput)}
                  selectedIds={grantSelectedRecordIds}
                  onChange={setGrantSelectedRecordIds}
                  disabled={loading}
                />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "20px" }}>
                <PillButton
                  size="md"
                  variant="primary"
                  onClick={grantAccess}
                  disabled={loading}
                >
                  {loading ? "Processing…" : `Grant Access (${selectedDuration} min)`}
                </PillButton>

                <PillButton
                  size="md"
                  variant="outline"
                  onClick={() => checkAccess()}
                  disabled={loading}
                >
                  Check On-Chain Status
                </PillButton>

                <PillButton
                  size="md"
                  variant="solid"
                  onClick={() => revokeAccess()}
                  disabled={loading}
                >
                  Revoke Immediately
                </PillButton>
              </div>

              {checkResult && (
                <div style={{ marginTop: "18px" }}>
                  <ConsentStatus detail={checkResult} />
                </div>
              )}

              {message && (
                <div style={{ marginTop: "16px" }}>
                  <StatusMessage type={message.type}>{message.text}</StatusMessage>
                </div>
              )}
            </div>

            {/* Active Grants List */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--text-tertiary)",
                  }}
                >
                  ACTIVE & HISTORICAL DOCTOR GRANTS
                </span>
                <PillButton size="sm" variant="outline" onClick={fetchGrants}>
                  Refresh
                </PillButton>
              </div>

              {grantsState === "checking" && <ConsentStatus detail={{ status: "checking" }} />}
              {grantsState === "verification-unavailable" && <ConsentStatus detail={{ status: "verification-unavailable" }} />}

              {activeGrants.length === 0 && grantsState === "ready" && (
                <p style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                  No active or saved doctor grants recorded.
                </p>
              )}
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {activeGrants.map((grant) => (
                    <div
                      key={grant.doctorAddress}
                      className="glass-card spatial-layer-2"
                      style={{
                        padding: "16px 20px",
                        borderRadius: "var(--radius-spatial-md)",
                        border: "1px solid var(--border-subtle)",
                        background: "var(--bg-surface)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "12px",
                      }}
                    >
                      <div>
                        {/* Doctor identity row in grant card */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                          <div
                            style={{
                              width: '30px',
                              height: '30px',
                              borderRadius: '50%',
                              background: 'var(--primary-dark)',
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '12px',
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {(grant.doctorName && !grant.doctorName.startsWith('Wallet ')
                              ? grant.doctorName
                              : 'D'
                            ).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <strong style={{ fontSize: '13px' }}>
                              {grant.doctorName && !grant.doctorName.startsWith('Wallet ') ? grant.doctorName : 'Care Provider'}
                            </strong>
                            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                              {grant.doctorAddress ? `${grant.doctorAddress.slice(0, 6)}\u2026${grant.doctorAddress.slice(-4)}` : ''}
                            </span>
                          </div>
                        </div>
                        <div style={{ marginTop: "6px" }}>
                          <ConsentStatus detail={grant} />
                        </div>
                        {(() => {
                          const shareable = getShareableRecords(uploadedRecords, grant.doctorAddress);
                          const sharedCount = Array.isArray(grant.sharedRecordIds)
                            ? grant.sharedRecordIds.filter(id => shareable.some(r => String(r.id) === String(id))).length
                            : Math.min(grant.sharedRecordCount ?? 0, shareable.length);
                          return (
                            <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--text-secondary)", fontWeight: 500 }}>
                              📁 {sharedCount} of {shareable.length} records shared
                            </div>
                          );
                        })()}
                      </div>

                      {grant.status === "active" && (
                        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                          <PillButton
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              setManagingGrant(grant);
                              setManageError("");
                              setManageSuccess("");
                              const shareable = getShareableRecords(uploadedRecords, grant.doctorAddress);
                              const shareableIds = new Set(shareable.map(r => String(r.id)));
                              try {
                                const data = await apiRequest(`/consent/allowlist/${grant.doctorAddress}`);
                                const filtered = (data.recordIds || []).filter(id => shareableIds.has(String(id)));
                                setManagingRecordIds(filtered);
                              } catch {
                                const filtered = (grant.sharedRecordIds || []).filter(id => shareableIds.has(String(id)));
                                setManagingRecordIds(filtered);
                              }
                            }}
                            disabled={loading}
                          >
                            Manage shared records
                          </PillButton>
                          <PillButton
                            size="sm"
                            variant="outline"
                            onClick={() => revokeAccess(grant.doctorAddress)}
                            disabled={loading}
                          >
                            Revoke
                          </PillButton>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: EMERGENCY QR ── */}
        {activeTab === "qr" && (
          <div style={{ textAlign: "center", maxWidth: "560px", margin: "0 auto" }}>
            <span className="section-label" style={{ marginBottom: "6px", justifyContent: "center" }}>
              EMERGENCY PROTOCOL
            </span>
            <h3 className="two-tone-heading" style={{ fontSize: "22px", margin: "0 0 12px 0" }}>
              Emergency <span className="highlight-primary">QR Access</span>
            </h3>
            <p style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: "20px" }}>
              Generate a one-hour self-expiring code. First responders scan it to view essential life-saving data with zero login or password.
            </p>

            {/* Public Endpoint Status Banner */}
            {qrConfig && !qrConfig.configured ? (
              <div
                className="glass-card"
                style={{
                  padding: "16px 20px",
                  borderRadius: "var(--radius-spatial-md)",
                  border: "1px solid var(--status-warning-border, #fcd34d)",
                  background: "var(--status-warning-bg, #fef3c7)",
                  color: "var(--status-warning-text, #92400e)",
                  marginBottom: "20px",
                  textAlign: "left",
                  fontSize: "12px",
                  lineHeight: 1.6
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 700, marginBottom: "4px" }}>
                  <span>⚠️</span>
                  <span>Public Cross-Device Endpoint Not Configured</span>
                </div>
                <div>
                  Cross-device mobile scanning requires a public HTTPS base URL. Set <code>EMERGENCY_QR_BASE_URL</code> (e.g. Cloudflare Tunnel or public HTTPS domain) in the backend. Localhost addresses are blocked to prevent generating unscanable QR codes.
                </div>
              </div>
            ) : qrConfig?.host ? (
              <div
                style={{
                  padding: "8px 16px",
                  borderRadius: "var(--radius-pill)",
                  background: "var(--status-success-bg, #dcfce7)",
                  color: "var(--status-success-text, #166534)",
                  fontSize: "12px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  marginBottom: "20px",
                  fontWeight: 600
                }}
              >
                <span>🌐</span>
                <span>Public Scanner Endpoint: <strong>{qrConfig.host}</strong> (HTTPS Verified)</span>
              </div>
            ) : null}

            <div
              className="glass-card spatial-layer-2"
              style={{
                padding: "24px",
                borderRadius: "var(--radius-spatial-lg)",
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-surface-subtle)",
                textAlign: "left",
                marginBottom: "24px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)" }}>
                  Clinical Emergency Payload
                </span>
                <PillButton
                  size="sm"
                  variant="outline"
                  onClick={() => setEditingQr(!editingQr)}
                >
                  {editingQr ? "Done" : "Edit Fields"}
                </PillButton>
              </div>

              {editingQr ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {[
                    { label: "Blood Type", key: "bloodType" },
                    { label: "Allergies", key: "allergies" },
                    { label: "Current Medications", key: "medications" },
                    { label: "Emergency Contact", key: "emergencyContact" },
                  ].map((field) => (
                    <PillInput
                      key={field.key}
                      label={field.label}
                      value={qrData[field.key]}
                      onChange={(e) => setQrData((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    />
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: "13px", lineHeight: 2, color: "var(--text-primary)" }}>
                  <div>🩸 <strong>Blood Type:</strong> {qrData.bloodType}</div>
                  <div>⚠️ <strong>Allergies:</strong> {qrData.allergies}</div>
                  <div>💊 <strong>Medications:</strong> {qrData.medications}</div>
                  <div>📞 <strong>Emergency Contact:</strong> {qrData.emergencyContact}</div>
                </div>
              )}

              {qrUrl && qrExpiry && (
                <div
                  style={{
                    marginTop: "16px",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: "var(--primary-tint)",
                    border: "1px solid var(--primary-light)",
                    fontSize: "12px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "8px"
                  }}
                >
                  <span>⏱ Active QR Code auto-expires at <strong>{qrExpiry}</strong></span>
                  <button
                    type="button"
                    onClick={revokeQR}
                    disabled={qrRevoking}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--status-error-text)",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "12px",
                      textDecoration: "underline"
                    }}
                  >
                    {qrRevoking ? "Revoking…" : "Revoke now"}
                  </button>
                </div>
              )}

              <div style={{ marginTop: "24px", display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}>
                <PillButton
                  size="lg"
                  variant="primary"
                  onClick={generateQR}
                  disabled={qrLoading}
                >
                  {qrLoading ? "Generating QR…" : (qrUrl ? "Regenerate Emergency QR" : "Generate Emergency QR")}
                </PillButton>
                {qrUrl && (
                  <PillButton
                    size="lg"
                    variant="outline"
                    onClick={() => setQrVisible(true)}
                  >
                    View Active QR Code
                  </PillButton>
                )}
              </div>
            </div>
          </div>
        )}


        {/* ── TAB 4: APPOINTMENTS ── */}
        {activeTab === "appointments" && (
          <div>
            <span className="section-label" style={{ marginBottom: "6px" }}>
              CARE SCHEDULING
            </span>
            <h3 className="two-tone-heading" style={{ fontSize: "20px", margin: "0 0 20px 0" }}>
              Clinical <span className="highlight-primary">Appointments</span>
            </h3>

            {/* Booking Form Card */}
            <div
              className="glass-card spatial-layer-1"
              style={{
                background: "var(--bg-surface-subtle)",
                padding: "24px",
                borderRadius: "var(--radius-spatial-lg)",
                border: "1px solid var(--border-subtle)",
                marginBottom: "32px",
              }}
            >
              <h4 style={{ fontSize: "14px", fontWeight: 600, margin: "0 0 14px 0" }}>
                Book Consultation
              </h4>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "14px", marginBottom: "14px" }}>
                <PillInput
                  label="Doctor Wallet or ID"
                  placeholder="0x… or HV-…"
                  value={appointmentDoctor}
                  onChange={(e) => setAppointmentDoctor(e.target.value)}
                  required
                />

                <label className="field-label">
                  Select Provider
                  <select
                    value={newAppt.doctor}
                    onChange={(e) => setNewAppt((prev) => ({ ...prev, doctor: e.target.value }))}
                  >
                    <option>Dr. Arjun Sharma — General Physician</option>
                    <option>Dr. Meena Nair — Cardiologist</option>
                    <option>Dr. Suresh Mehta — Endocrinologist</option>
                  </select>
                </label>

                <label className="field-label">
                  Preferred Date
                  <input
                    type="date"
                    value={newAppt.date}
                    onChange={(e) => setNewAppt((prev) => ({ ...prev, date: e.target.value }))}
                  />
                </label>

                <label className="field-label">
                  Time Slot
                  <select
                    value={newAppt.time}
                    onChange={(e) => setNewAppt((prev) => ({ ...prev, time: e.target.value }))}
                  >
                    {["09:00 AM", "10:00 AM", "11:00 AM", "02:00 PM", "03:00 PM", "04:00 PM"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>

              <PillInput
                label="Reason for Visit"
                placeholder="e.g. Regular diabetes checkup and medication review"
                value={newAppt.reason}
                onChange={(e) => setNewAppt((prev) => ({ ...prev, reason: e.target.value }))}
              />

              <div style={{ marginTop: "18px" }}>
                <PillButton
                  size="md"
                  variant="primary"
                  onClick={bookAppointment}
                  disabled={booking}
                >
                  {booking ? "Sending request…" : "Request Appointment"}
                </PillButton>
              </div>

              {apptMessage && (
                <div style={{ marginTop: "14px" }}>
                  <StatusMessage type={apptMessage.type}>{apptMessage.text}</StatusMessage>
                </div>
              )}
            </div>

            {/* Existing Appointments List */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-tertiary)" }}>
                  YOUR SCHEDULED VISITS
                </span>
                <PillButton size="sm" variant="outline" onClick={fetchAppointments} disabled={apptLoading}>
                  {apptLoading ? "Refreshing…" : "Refresh"}
                </PillButton>
              </div>

              {appointments.length === 0 ? (
                <EmptyState
                  icon="📅"
                  title="No appointments scheduled"
                  description="Use the booking panel above to request an appointment with your care provider."
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {appointments.map((apt, i) => (
                    <div
                      key={i}
                      className="glass-card spatial-layer-2"
                      style={{
                        padding: "16px 20px",
                        borderRadius: "var(--radius-spatial-md)",
                        border: "1px solid var(--border-subtle)",
                        background: "var(--bg-surface)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: "12px",
                      }}
                    >
                      <div>
                        <strong>{apt.reason}</strong>
                        <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                          {apt.doctor} · {new Date(apt.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} at {apt.time}
                        </div>
                        {apt.status === "confirmed" && apt.confirmedAt && (
                          <span style={{ fontSize: "11px", color: "var(--status-success-text)" }}>
                            ✓ Confirmed by doctor
                          </span>
                        )}
                      </div>

                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          padding: "4px 12px",
                          borderRadius: "var(--radius-pill)",
                          background: apt.status === "confirmed" ? "var(--status-success-bg)" : "var(--status-warning-bg)",
                          color: apt.status === "confirmed" ? "var(--status-success-text)" : "var(--status-warning-text)",
                        }}
                      >
                        {apt.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 5: AUDIT TRAIL ── */}
        {activeTab === "audit" && <AuditDashboard account={account} />}
      </div>

      {/* Emergency QR Modal */}
      <Modal
        isOpen={qrVisible}
        onClose={() => setQrVisible(false)}
        title="Emergency Medical Profile"
        subtitle={qrExpiry ? `One-hour temporary QR code · Auto-expires at ${qrExpiry}` : "First-responder temporary access"}
        maxWidth="480px"
      >
        <div style={{ textAlign: "center", padding: "8px 0" }}>
          {qrUrl ? (
            <>
              <div
                className="glass-card"
                style={{
                  display: "inline-block",
                  padding: "16px",
                  borderRadius: "var(--radius-spatial-md)",
                  border: "2px solid var(--primary-mid)",
                  background: "#FFFFFF",
                  boxShadow: "var(--shadow-spatial-elevated)",
                  marginBottom: "16px",
                }}
              >
                <QRCodeSVG value={qrUrl} size={200} level="H" includeMargin={true} />
              </div>

              {/* Status and Expiry */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginBottom: "14px", flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    padding: "3px 10px",
                    borderRadius: "var(--radius-pill)",
                    background: "var(--status-success-bg, #dcfce7)",
                    color: "var(--status-success-text, #166534)",
                  }}
                >
                  ● Active
                </span>
                <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                  Auto-expires at <strong>{qrExpiry}</strong>
                </span>
              </div>

              {/* Destination Host & Link Info Card */}
              <div
                className="glass-card"
                style={{
                  padding: "12px 14px",
                  borderRadius: "var(--radius-spatial-md)",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--bg-surface-subtle)",
                  textAlign: "left",
                  marginBottom: "16px",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>🌐 Destination:</span>
                    <span style={{ color: "var(--status-success-text, #166534)", fontWeight: 700 }}>
                      {qrConfig?.host || (qrUrl ? new URL(qrUrl).host : "")}
                    </span>
                  </span>
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 700,
                      background: "var(--status-success-bg, #dcfce7)",
                      color: "var(--status-success-text, #166534)",
                      padding: "2px 8px",
                      borderRadius: "var(--radius-pill)",
                    }}
                  >
                    HTTPS Verified
                  </span>
                </div>

                <div
                  style={{
                    fontFamily: "monospace",
                    fontSize: "11px",
                    color: "var(--text-secondary)",
                    background: "var(--bg-surface)",
                    padding: "8px 10px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle)",
                    wordBreak: "break-all",
                    userSelect: "all",
                    marginBottom: "10px",
                  }}
                >
                  {qrUrl}
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button
                    type="button"
                    onClick={handleCopyLink}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "var(--radius-pill)",
                      border: "1px solid var(--border-subtle)",
                      background: "var(--bg-surface)",
                      color: "var(--text-primary)",
                      fontSize: "11px",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    <span>📋</span>
                    <span>{copyStatus || "Copy Scan Link"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={revokeQR}
                    disabled={qrRevoking}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "var(--status-error-text, #b91c1c)",
                      fontWeight: 600,
                      cursor: "pointer",
                      fontSize: "11px",
                      textDecoration: "underline",
                    }}
                  >
                    {qrRevoking ? "Revoking…" : "Revoke QR"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                <PillButton size="md" variant="outline" onClick={() => setQrVisible(false)}>
                  Close
                </PillButton>
                <PillButton
                  size="md"
                  variant="primary"
                  onClick={() => {
                    setQrVisible(false);
                    setEditingQr(true);
                  }}
                >
                  Edit & Regenerate
                </PillButton>
              </div>
            </>
          ) : (
            <div style={{ padding: "16px 0" }}>
              <p style={{ color: "var(--text-secondary)", fontSize: "13px", marginBottom: "12px" }}>
                No active emergency QR code is currently active.
              </p>
              {qrConfig && !qrConfig.configured && (
                <p style={{ color: "var(--status-warning-text, #92400e)", fontSize: "12px" }}>
                  Public access is not configured. An HTTPS endpoint is required to generate a cross-device QR code.
                </p>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* PDF Viewer Modal */}
      <Modal
        isOpen={pdfModalOpen && !!selectedPdfRecord}
        onClose={() => {
          setPdfModalOpen(false);
          setSelectedPdfRecord(null);
        }}
        title={selectedPdfRecord?.fileName || "Clinical Document"}
        subtitle="Encrypted with AES-256-GCM · Streamed directly from verified vault"
        maxWidth="840px"
      >
        {selectedPdfRecord && (
          <PatientRecordViewer record={selectedPdfRecord} />
        )}
      </Modal>

      {/* Manage Shared Records Modal */}
      <Modal
        isOpen={!!managingGrant}
        onClose={() => {
          setManagingGrant(null);
          setManageError("");
          setManageSuccess("");
        }}
        title={`Manage Shared Records · ${managingGrant?.doctorName || "Care Provider"}`}
        subtitle={`Doctor: ${managingGrant?.doctorAddress || ""}`}
        maxWidth="600px"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: 0 }}>
            Choose which clinical documents and records this care provider can view. Changes take effect immediately.
          </p>

          <RecordChecklist
            records={getShareableRecords(uploadedRecords, managingGrant?.doctorAddress)}
            selectedIds={managingRecordIds}
            onChange={setManagingRecordIds}
            disabled={manageSaving}
            contextMessage={(() => {
              if (!managingGrant) return null;
              const shareable = getShareableRecords(uploadedRecords, managingGrant.doctorAddress);
              if (shareable.length > 0) return null;
              // Count how many records this doctor uploaded for this patient
              const docLower = managingGrant.doctorAddress ? managingGrant.doctorAddress.toLowerCase() : '';
              const doctorUploads = uploadedRecords.filter(r =>
                r.doctorAddress && r.doctorAddress.toLowerCase() === docLower
              );
              if (doctorUploads.length > 0) {
                return `Records uploaded by this doctor are already visible to them. You have no other records to share. (${doctorUploads.length} record${doctorUploads.length > 1 ? 's' : ''} uploaded by this provider)`;
              }
              return null;
            })()}
          />

          {manageError && (
            <StatusMessage type="error">{manageError}</StatusMessage>
          )}

          {manageSuccess && (
            <StatusMessage type="success">{manageSuccess}</StatusMessage>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <PillButton
              size="md"
              variant="outline"
              onClick={() => {
                setManagingGrant(null);
                setManageError("");
                setManageSuccess("");
              }}
              disabled={manageSaving}
            >
              Cancel
            </PillButton>
            <PillButton
              size="md"
              variant="primary"
              onClick={saveSharedRecords}
              disabled={manageSaving}
            >
              {manageSaving ? "Saving..." : "Save Shared Records"}
            </PillButton>
          </div>
        </div>
      </Modal>
    </div>
  );
}
