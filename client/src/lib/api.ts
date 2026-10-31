import axios from 'axios';
import { getAuthToken } from './authStorage';

// Se VITE_API_URL não for informada, faz fallback para o servidor de produção na nuvem (Render)
const DEFAULT_PROD_API = 'https://xolas-server.onrender.com';
const DEFAULT_DEV_API = 'https://xolas-server.onrender.com';

export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? DEFAULT_PROD_API : DEFAULT_DEV_API);

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
