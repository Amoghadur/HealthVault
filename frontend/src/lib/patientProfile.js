export const BLOOD_GROUPS = [
  "",
  "A+",
  "A-",
  "B+",
  "B-",
  "AB+",
  "AB-",
  "O+",
  "O-",
];

export const DIABETES_OPTIONS = [
  "Type 1 diabetes",
  "Type 2 diabetes",
  "Prediabetes",
  "No diabetes",
  "Unknown / Not provided",
];

export const ALLERGIES_STATUS_OPTIONS = [
  { value: "unknown", label: "Unknown / Not provided" },
  { value: "no_known_allergies", label: "No known allergies" },
  { value: "has_allergies", label: "Known allergies" },
];

export const DEFAULT_PATIENT_PROFILE = {
  displayName: "",
  avatar: "",
  phone: "",
  dateOfBirth: "",
  bloodGroup: "",
  about: "",
  emergencyContactName: "",
  emergencyContactPhone: "",
  allergies: [],
  allergiesStatus: "unknown",
  diabetesStatus: "Unknown / Not provided",
};

export const PRESET_AVATARS = [
  { id: "emerald", label: "Emerald Ring", gradient: "linear-gradient(135deg, #238071 0%, #7CC4B5 100%)", icon: "✦" },
  { id: "teal", label: "Teal Crest", gradient: "linear-gradient(135deg, #1A6056 0%, #5FB5A5 100%)", icon: "⌂" },
  { id: "mint", label: "Mint Leaf", gradient: "linear-gradient(135deg, #5FB5A5 0%, #A8D8CE 100%)", icon: "◉" },
  { id: "sage", label: "Sage Shield", gradient: "linear-gradient(135deg, #2D5A50 0%, #89C7B9 100%)", icon: "◈" },
  { id: "aqua", label: "Aqua Core", gradient: "linear-gradient(135deg, #15463E 0%, #4EAA98 100%)", icon: "✚" },
];

export function formatShortAddress(address) {
  if (!address || typeof address !== "string") return "";
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function calculateAge(dateOfBirth) {
  if (!dateOfBirth || typeof dateOfBirth !== "string") return null;
  const birth = new Date(dateOfBirth);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age >= 0 && age <= 130 ? age : null;
}

export function validateClientPatientProfile(fields) {
  const errors = {};

  const name = (fields.displayName || "").trim();
  if (!name) {
    errors.displayName = "Display name is required.";
  } else if (name.length < 2) {
    errors.displayName = "Display name must be at least 2 characters.";
  } else if (name.length > 40) {
    errors.displayName = "Display name must be at most 40 characters.";
  }

  if (fields.phone) {
    const phone = fields.phone.trim();
    if (phone.length > 20) {
      errors.phone = "Phone number must be at most 20 characters.";
    } else if (!/^[0-9+\s()-]*$/.test(phone)) {
      errors.phone = "Phone number contains invalid characters.";
    }
  }

  if (fields.dateOfBirth) {
    const dob = fields.dateOfBirth.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      errors.dateOfBirth = "Date of birth must be in YYYY-MM-DD format.";
    } else {
      const parsed = Date.parse(dob);
      if (isNaN(parsed) || parsed > Date.now()) {
        errors.dateOfBirth = "Date of birth must be a valid past date.";
      }
    }
  }

  if (fields.bloodGroup && !BLOOD_GROUPS.includes(fields.bloodGroup)) {
    errors.bloodGroup = "Invalid blood group selected.";
  }

  if (fields.about && fields.about.trim().length > 120) {
    errors.about = "About bio must be at most 120 characters.";
  }

  if (fields.emergencyContactName && fields.emergencyContactName.trim().length > 60) {
    errors.emergencyContactName = "Emergency contact name must be at most 60 characters.";
  }

  if (fields.emergencyContactPhone) {
    const ecp = fields.emergencyContactPhone.trim();
    if (ecp.length > 20) {
      errors.emergencyContactPhone = "Emergency contact phone must be at most 20 characters.";
    } else if (!/^[0-9+\s()-]*$/.test(ecp)) {
      errors.emergencyContactPhone = "Emergency contact phone contains invalid characters.";
    }
  }

  if (fields.avatar && fields.avatar.length > 300_000) {
    errors.avatar = "Avatar image exceeds the 200 KB size limit.";
  }

  if (fields.diabetesStatus && !DIABETES_OPTIONS.includes(fields.diabetesStatus) && fields.diabetesStatus !== "Unknown") {
    errors.diabetesStatus = "Invalid diabetes status selected.";
  }

  if (fields.allergies && Array.isArray(fields.allergies)) {
    for (const a of fields.allergies) {
      if (typeof a === "string" && a.trim().length > 50) {
        errors.allergies = "Each allergy must be at most 50 characters.";
        break;
      }
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

export function processAvatarFile(file, { maxSize = 256, maxBytes = 200 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error("No file provided"));
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      return reject(new Error("Please upload a PNG, JPEG, or WebP image."));
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image."));
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = maxSize;
          canvas.height = maxSize;
          const ctx = canvas.getContext("2d");

          // Calculate center crop
          const minDim = Math.min(img.width, img.height);
          const sx = (img.width - minDim) / 2;
          const sy = (img.height - minDim) / 2;

          ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, maxSize, maxSize);

          let dataUrl = canvas.toDataURL("image/webp", 0.85);
          if (dataUrl.length > maxBytes * 1.33) {
            dataUrl = canvas.toDataURL("image/jpeg", 0.7);
          }

          if (dataUrl.length > maxBytes * 1.33) {
            return reject(new Error("Compressed image still exceeds 200 KB. Please choose a smaller file."));
          }

          resolve(dataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
