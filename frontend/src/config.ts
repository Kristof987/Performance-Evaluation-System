const { VITE_API_URL } = import.meta.env;

const LOCAL_API_URL = 'http://localhost:8000';

export const API_BASE_URL = VITE_API_URL || LOCAL_API_URL;