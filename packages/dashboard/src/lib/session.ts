export const AUTH_TOKEN_KEY = 'biuro.authToken';
export const CSRF_TOKEN_KEY = 'biuro.csrfToken';
export const COMPANY_STORAGE_KEY = 'biuro.selectedCompanyId';
export const AUTH_EVENT = 'biuro:auth-changed';

export function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function getCsrfToken() {
  return localStorage.getItem(CSRF_TOKEN_KEY);
}

export function setAuthToken(token: string, csrfToken?: string | null) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  if (csrfToken) {
    localStorage.setItem(CSRF_TOKEN_KEY, csrfToken);
  } else {
    localStorage.removeItem(CSRF_TOKEN_KEY);
  }
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

export function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(CSRF_TOKEN_KEY);
  localStorage.removeItem(COMPANY_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}

export function getSelectedCompanyId() {
  return localStorage.getItem(COMPANY_STORAGE_KEY);
}
