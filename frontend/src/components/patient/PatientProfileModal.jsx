import { useState, useRef } from "react";
import Modal from "../common/Modal";
import PillInput from "../common/PillInput";
import PillButton from "../common/PillButton";
import {
  BLOOD_GROUPS,
  PRESET_AVATARS,
  DIABETES_OPTIONS,
  validateClientPatientProfile,
  processAvatarFile,
} from "../../lib/patientProfile";
import { apiRequest } from "../../lib/api";

function PatientProfileForm({ initialProfile, onClose, onSaveSuccess }) {
  const [formData, setFormData] = useState(() => ({
    displayName: initialProfile?.displayName || '',
    avatar: initialProfile?.avatar || '',
    phone: initialProfile?.phone || '',
    dateOfBirth: initialProfile?.dateOfBirth || '',
    bloodGroup: initialProfile?.bloodGroup || '',
    about: initialProfile?.about || '',
    emergencyContactName: initialProfile?.emergencyContactName || '',
    emergencyContactPhone: initialProfile?.emergencyContactPhone || '',
    showIdentityToDoctors: initialProfile?.showIdentityToDoctors !== false,
    allergies: Array.isArray(initialProfile?.allergies) ? initialProfile.allergies : [],
    allergiesStatus: initialProfile?.allergiesStatus || (Array.isArray(initialProfile?.allergies) && initialProfile.allergies.length > 0 ? "has_allergies" : "unknown"),
    diabetesStatus: initialProfile?.diabetesStatus || "Unknown / Not provided",
  }));
  const [newAllergyInput, setNewAllergyInput] = useState("");
  const [allergyInputError, setAllergyInputError] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const fileInputRef = useRef(null);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleAddAllergy = () => {
    const trimmed = newAllergyInput.trim();
    if (!trimmed) {
      setAllergyInputError("Please enter an allergy name.");
      return;
    }
    if (trimmed.length > 50) {
      setAllergyInputError("Allergy name must be at most 50 characters.");
      return;
    }
    if (formData.allergies.some((a) => a.toLowerCase() === trimmed.toLowerCase())) {
      setAllergyInputError("This allergy is already listed.");
      return;
    }
    setFormData((prev) => ({
      ...prev,
      allergies: [...prev.allergies, trimmed],
      allergiesStatus: "has_allergies",
    }));
    setNewAllergyInput("");
    setAllergyInputError("");
  };

  const handleRemoveAllergy = (indexToRemove) => {
    setFormData((prev) => ({
      ...prev,
      allergies: prev.allergies.filter((_, idx) => idx !== indexToRemove),
    }));
  };

  const handleAllergyStatusChange = (status) => {
    setFormData((prev) => ({
      ...prev,
      allergiesStatus: status,
      allergies: (status === "no_known_allergies" || status === "unknown") ? [] : prev.allergies,
    }));
    setAllergyInputError("");
  };

  const handleAvatarFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setGlobalError("");
      const dataUrl = await processAvatarFile(file);
      handleChange("avatar", dataUrl);
    } catch (err) {
      setGlobalError(err.message || "Failed to process image.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePresetAvatar = (preset) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 160, 160);
      grad.addColorStop(0, "#238071");
      grad.addColorStop(1, "#7CC4B5");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(80, 80, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 64px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(preset.icon, 80, 84);
      const webpUrl = canvas.toDataURL("image/webp", 0.9);
      handleChange("avatar", webpUrl);
    } catch {
      // Fallback
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGlobalError("");
    setSuccessMessage("");

    const validation = validateClientPatientProfile(formData);
    if (!validation.isValid) {
      setErrors(validation.errors);
      return;
    }

    setSaving(true);
    try {
      const result = await apiRequest("/api/patient/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      setSuccessMessage("Profile saved successfully.");
      if (onSaveSuccess) {
        onSaveSuccess(result.profile);
      }
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      setGlobalError(err.message || "Failed to save profile. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {globalError && (
        <div
          role="alert"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-spatial-sm)",
            background: "var(--status-error-bg)",
            border: "1px solid var(--status-error-border)",
            color: "var(--status-error-text)",
            fontSize: "13px",
          }}
        >
          {globalError}
        </div>
      )}

      {successMessage && (
        <div
          role="status"
          style={{
            padding: "12px 16px",
            borderRadius: "var(--radius-spatial-sm)",
            background: "var(--primary-tint)",
            border: "1px solid var(--primary-mid)",
            color: "var(--primary-dark)",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          ✓ {successMessage}
        </div>
      )}

      {/* Avatar Section */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "20px",
          padding: "16px",
          borderRadius: "var(--radius-spatial-md)",
          background: "rgba(35, 128, 113, 0.05)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <div
          style={{
            width: "68px",
            height: "68px",
            borderRadius: "50%",
            overflow: "hidden",
            background: "linear-gradient(135deg, var(--primary) 0%, var(--primary-mid) 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: "26px",
            fontWeight: 700,
            flexShrink: 0,
            boxShadow: "0 4px 12px rgba(35, 128, 113, 0.2)",
            border: "2px solid #fff",
          }}
        >
          {formData.avatar ? (
            <img
              src={formData.avatar}
              alt="Profile Avatar"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            (formData.displayName || "P").trim().charAt(0).toUpperCase()
          )}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "8px" }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={handleAvatarFile}
            />
            <PillButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              Upload photo
            </PillButton>
            {formData.avatar && (
              <PillButton
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => handleChange("avatar", "")}
              >
                Remove
              </PillButton>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>Presets:</span>
            {PRESET_AVATARS.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.label}
                onClick={() => handlePresetAvatar(p)}
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  background: p.gradient,
                  border: "1px solid rgba(255,255,255,0.8)",
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: "10px",
                }}
              >
                {p.icon}
              </button>
            ))}
          </div>
          <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>
            Square PNG, JPEG, or WebP up to 200 KB.
          </div>
        </div>
      </div>

      {/* Display Name */}
      <div>
        <PillInput
          id="patient-profile-display-name"
          label="Display Name *"
          value={formData.displayName}
          onChange={(e) => handleChange("displayName", e.target.value)}
          placeholder="e.g. Ananya Roy"
          maxLength={40}
          error={errors.displayName}
          required
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "2px" }}>
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            {formData.displayName.length} / 40
          </span>
        </div>
      </div>

      {/* Row: Phone & Date of Birth */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <PillInput
          id="patient-profile-phone"
          label="Phone Number"
          type="tel"
          value={formData.phone}
          onChange={(e) => handleChange("phone", e.target.value)}
          placeholder="+91 98765 43210"
          maxLength={20}
          error={errors.phone}
        />
        <PillInput
          id="patient-profile-dob"
          label="Date of Birth"
          type="date"
          value={formData.dateOfBirth}
          onChange={(e) => handleChange("dateOfBirth", e.target.value)}
          error={errors.dateOfBirth}
        />
      </div>

      {/* Row: Blood Group & Bio */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
        <div className="pill-input-group" style={{ width: "100%" }}>
          <label
            htmlFor="patient-profile-blood-group"
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
            Blood Group
          </label>
          <select
            id="patient-profile-blood-group"
            className="pill-input"
            value={formData.bloodGroup}
            onChange={(e) => handleChange("bloodGroup", e.target.value)}
            style={{
              width: "100%",
              background: "var(--glass-l2-bg)",
              borderColor: errors.bloodGroup ? "var(--status-error-border)" : undefined,
            }}
          >
            <option value="">Select blood group (optional)</option>
            {BLOOD_GROUPS.filter(Boolean).map((bg) => (
              <option key={bg} value={bg}>
                {bg}
              </option>
            ))}
          </select>
          {errors.bloodGroup && (
            <p role="alert" style={{ margin: "6px 0 0 16px", fontSize: "11px", color: "var(--status-error-text)" }}>
              {errors.bloodGroup}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="patient-profile-about"
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
            About / Bio
          </label>
          <textarea
            id="patient-profile-about"
            className="pill-input"
            rows={2}
            value={formData.about}
            onChange={(e) => handleChange("about", e.target.value)}
            placeholder="Brief note or health priority (max 120 characters)"
            maxLength={120}
            style={{
              borderRadius: "var(--radius-spatial-md)",
              padding: "12px 18px",
              minHeight: "70px",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "2px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
              {formData.about.length} / 120
            </span>
          </div>
          {errors.about && (
            <p role="alert" style={{ margin: "4px 0 0 16px", fontSize: "11px", color: "var(--status-error-text)" }}>
              {errors.about}
            </p>
          )}
        </div>
      </div>

      {/* Medical Profile Section (Diabetes & Allergies) */}
      <div
        style={{
          padding: "18px",
          borderRadius: "var(--radius-spatial-md)",
          background: "rgba(35, 128, 113, 0.04)",
          border: "1px solid var(--border-soft)",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--primary-dark)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span>🩺</span>
          <span>Medical Profile & Clinical Conditions</span>
        </div>

        {/* Diabetes Status Field */}
        <div className="pill-input-group" style={{ width: "100%" }}>
          <label
            htmlFor="patient-profile-diabetes-status"
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
            Diabetes Information
          </label>
          <select
            id="patient-profile-diabetes-status"
            className="pill-input"
            value={formData.diabetesStatus}
            onChange={(e) => handleChange("diabetesStatus", e.target.value)}
            style={{
              width: "100%",
              background: "var(--glass-l2-bg)",
              borderColor: errors.diabetesStatus ? "var(--status-error-border)" : undefined,
            }}
          >
            {DIABETES_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {errors.diabetesStatus && (
            <p role="alert" style={{ margin: "6px 0 0 16px", fontSize: "11px", color: "var(--status-error-text)" }}>
              {errors.diabetesStatus}
            </p>
          )}
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px", display: "block" }}>
            Select your confirmed diagnosis or choose &ldquo;No diabetes&rdquo; / &ldquo;Unknown&rdquo;.
          </span>
        </div>

        {/* Known Allergies Field */}
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

          {/* Allergy Status Option Radios */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "12px" }}>
            {[
              { id: "allergy-status-has", value: "has_allergies", label: "I have known allergies" },
              { id: "allergy-status-nkda", value: "no_known_allergies", label: "No known allergies (NKDA)" },
              { id: "allergy-status-unknown", value: "unknown", label: "Unknown / Not provided" },
            ].map((opt) => (
              <label
                key={opt.value}
                htmlFor={opt.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: "6px 12px",
                  borderRadius: "var(--radius-pill)",
                  background: formData.allergiesStatus === opt.value ? "var(--primary-tint)" : "var(--bg-surface)",
                  border: formData.allergiesStatus === opt.value ? "1px solid var(--primary-mid)" : "1px solid var(--border-subtle)",
                  color: formData.allergiesStatus === opt.value ? "var(--primary-dark)" : "var(--text-secondary)",
                  fontWeight: formData.allergiesStatus === opt.value ? 600 : 500,
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="radio"
                  id={opt.id}
                  name="allergiesStatus"
                  value={opt.value}
                  checked={formData.allergiesStatus === opt.value}
                  onChange={() => handleAllergyStatusChange(opt.value)}
                  style={{ accentColor: "var(--primary)" }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          {/* If Known Allergies is selected: Add allergy input & list */}
          {formData.allergiesStatus === "has_allergies" && (
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
                    id="patient-profile-add-allergy"
                    className="pill-input"
                    value={newAllergyInput}
                    onChange={(e) => {
                      setNewAllergyInput(e.target.value);
                      if (allergyInputError) setAllergyInputError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddAllergy();
                      }
                    }}
                    placeholder="Enter an allergy (e.g. Penicillin, Peanuts, Latex)"
                    maxLength={50}
                    style={{ width: "100%", fontSize: "12px", padding: "8px 14px" }}
                  />
                  {allergyInputError && (
                    <p role="alert" style={{ margin: "4px 0 0 8px", fontSize: "11px", color: "var(--status-error-text)" }}>
                      {allergyInputError}
                    </p>
                  )}
                </div>
                <PillButton
                  id="patient-profile-add-allergy-btn"
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={handleAddAllergy}
                >
                  + Add Allergy
                </PillButton>
              </div>

              {/* Render current allergies list */}
              {formData.allergies.length > 0 ? (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" }}>
                  {formData.allergies.map((allergy, idx) => (
                    <span
                      key={idx}
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
                        onClick={() => handleRemoveAllergy(idx)}
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
                  No allergies added yet. Type an allergy above and click &ldquo;+ Add Allergy&rdquo;.
                </p>
              )}
            </div>
          )}

          {formData.allergiesStatus === "no_known_allergies" && (
            <div
              style={{
                fontSize: "12px",
                color: "var(--status-success-text)",
                background: "var(--status-success-bg)",
                border: "1px solid var(--status-success-border, rgba(35, 128, 113, 0.2))",
                padding: "8px 12px",
                borderRadius: "var(--radius-spatial-sm)",
              }}
            >
              ✓ Explicitly confirmed: No known drug or medical allergies.
            </div>
          )}

          {formData.allergiesStatus === "unknown" && (
            <div
              style={{
                fontSize: "12px",
                color: "var(--text-secondary)",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-subtle)",
                padding: "8px 12px",
                borderRadius: "var(--radius-spatial-sm)",
              }}
            >
              ℹ️ Allergy status is currently unrecorded.
            </div>
          )}
        </div>
      </div>

      {/* Emergency Contact Group */}
      <div
        style={{
          padding: "18px",
          borderRadius: "var(--radius-spatial-md)",
          background: "rgba(35, 128, 113, 0.04)",
          border: "1px solid var(--border-soft)",
        }}
      >
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--primary-dark)",
            marginBottom: "12px",
          }}
        >
          Emergency Contact (Zero-Login QR Access)
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <PillInput
            id="patient-profile-ec-name"
            label="Contact Name"
            value={formData.emergencyContactName}
            onChange={(e) => handleChange("emergencyContactName", e.target.value)}
            placeholder="e.g. Sunita Sharma"
            maxLength={60}
            error={errors.emergencyContactName}
          />
          <PillInput
            id="patient-profile-ec-phone"
            label="Contact Phone"
            type="tel"
            value={formData.emergencyContactPhone}
            onChange={(e) => handleChange("emergencyContactPhone", e.target.value)}
            placeholder="+91 98765 43210"
            maxLength={20}
            error={errors.emergencyContactPhone}
          />
        </div>
      </div>

      {/* Privacy Settings */}
      <div
        style={{
          padding: '16px 18px',
          borderRadius: 'var(--radius-spatial-md)',
          background: 'rgba(35, 128, 113, 0.04)',
          border: '1px solid var(--border-soft)',
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--primary-dark)',
            marginBottom: '10px',
          }}
        >
          Privacy
        </div>
        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            id="patient-profile-show-identity"
            checked={formData.showIdentityToDoctors}
            onChange={(e) => handleChange('showIdentityToDoctors', e.target.checked)}
            style={{ accentColor: 'var(--primary)', width: '16px', height: '16px', marginTop: '1px', flexShrink: 0 }}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.5 }}>
            <strong>Show my name and photo to doctors who search for me</strong>
            <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              When enabled, doctors who look up your HealthVault ID will see your display name and avatar before you approve access.
              If disabled, you appear as an anonymous patient until you grant consent.
            </span>
          </span>
        </label>
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "8px" }}>
        <PillButton type="button" variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </PillButton>
        <PillButton type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : "Save Profile"}
        </PillButton>
      </div>
    </form>
  );
}

export default function PatientProfileModal({
  isOpen,
  onClose,
  initialProfile,
  onSaveSuccess,
}) {
  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Patient Profile"
      subtitle="Personalize your identity and clinical contacts across HealthVault."
      maxWidth="620px"
    >
      <PatientProfileForm
        key={initialProfile?.updatedAt || "new"}
        initialProfile={initialProfile}
        onClose={onClose}
        onSaveSuccess={onSaveSuccess}
      />
    </Modal>
  );
}
