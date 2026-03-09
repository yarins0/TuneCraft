// The base URL for all backend API requests.
// Vite exposes environment variables prefixed with VITE_ to the frontend.
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3000';