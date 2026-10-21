export const DEFAULT_RECORD_FILTERS = Object.freeze({
  query: '', category: '', doctorAddress: '', dateFrom: '', dateTo: '', sort: 'newest',
});

export function recordCategory(record) {
  return record.recordType || 'unspecified';
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateDateRange({ dateFrom = '', dateTo = '' } = {}) {
  if ((dateFrom && !validCalendarDate(dateFrom)) || (dateTo && !validCalendarDate(dateTo))) {
    return 'Enter valid upload dates.';
  }
  return dateFrom && dateTo && dateFrom > dateTo ? 'The start date must be on or before the end date.' : '';
}

function uploadTime(record) {
  return typeof record.uploadedAt === 'string' && record.uploadedAt.trim() ? Date.parse(record.uploadedAt) : NaN;
}

function localUploadDate(record) {
  const time = uploadTime(record);
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Operate only on already-authorized metadata. These helpers never fetch file contents.
export function filterRecords(records, { query = '', category = '', doctorAddress = '', dateFrom = '', dateTo = '' } = {}) {
  if (validateDateRange({ dateFrom, dateTo })) return [];
  const search = query.trim().toLowerCase();
  const wallet = doctorAddress.trim().toLowerCase();
  return records.filter(record => {
    if (search && !String(record.fileName || '').toLowerCase().includes(search)) return false;
    if (category && recordCategory(record) !== category) return false;
    if (wallet && String(record.doctorAddress || '').toLowerCase() !== wallet) return false;
    if (dateFrom || dateTo) {
      const date = localUploadDate(record);
      if (!date || (dateFrom && date < dateFrom) || (dateTo && date > dateTo)) return false;
    }
    return true;
  });
}

const compareIds = (a, b) => {
  const left = String(a.id), right = String(b.id);
  return left < right ? -1 : left > right ? 1 : 0;
};

export function sortRecords(records, sort = 'newest') {
  return [...records].sort((a, b) => {
    if (sort === 'title') {
      return String(a.fileName || '').localeCompare(String(b.fileName || ''), 'en', { sensitivity: 'base' }) || compareIds(a, b);
    }
    const left = uploadTime(a), right = uploadTime(b);
    // Missing/invalid dates stay last for both oldest and newest.
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : compareIds(a, b);
    if (!Number.isFinite(right)) return -1;
    return (sort === 'oldest' ? left - right : right - left) || compareIds(a, b);
  });
}

export function searchRecords(records, filters = {}) {
  return sortRecords(filterRecords(records, filters), filters.sort);
}
