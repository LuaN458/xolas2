import axios from 'axios';

// Em produção, se VITE_API_URL não for informada, faz fallback para o servidor na nuvem (Render)
const DEFAULT_PROD_API = 'https://xolas-server.onrender.com';
const DEFAULT_DEV_API = 'http://localhost:3001';

export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? DEFAULT_PROD_API : DEFAULT_DEV_API);

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('discord_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
