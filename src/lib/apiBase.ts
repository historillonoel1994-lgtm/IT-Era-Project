/**
 * Resolves backend API URLs so the React frontend works both:
 * 1. Same-origin (local dev / Vite middleware / reverse proxy): VITE_API_BASE_URL is empty -> "/api/..."
 * 2. Separate Netlify frontend + Render backend: VITE_API_BASE_URL="https://your-service.onrender.com" -> "https://your-service.onrender.com/api/..."
 */
const RAW_API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

export const API_BASE_URL = RAW_API_BASE.trim().replace(/\/+$/, '');

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!API_BASE_URL) {
    return normalizedPath;
  }
  return `${API_BASE_URL}${normalizedPath}`;
}
