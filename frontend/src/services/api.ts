import axios from 'axios';
import { fetchAuthSession, signOut } from 'aws-amplify/auth';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT token to every outgoing request
api.interceptors.request.use(async (config) => {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // No valid session — let the request go without a token;
    // the 401 response interceptor will handle the redirect.
  }
  return config;
});

// On 401 responses, clear the session and redirect to login
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      try {
        await signOut();
      } catch {
        // Ignore sign-out errors
      }
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
