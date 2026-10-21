export const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:4000';

export async function apiRequest(path, { headers, ...options } = {}) {
  const token = localStorage.getItem('healthvault_token');
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Cannot reach HealthVault. Check your connection and try again.', { cause: error });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 401 ? 'Your session has expired. Sign out and connect again.' : data?.error || `Request failed (${response.status}). Please try again.`);
  if (!data) throw new Error('The server returned an unreadable response. Please try again.');
  return data;
}
