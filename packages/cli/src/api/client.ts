import axios from 'axios';
import Conf from 'conf';

const config = new Conf({ projectName: 'biuro' });

const client = axios.create({
  baseURL: process.env.BIURO_API_URL || 'http://localhost:3000/api'
});

client.interceptors.request.use((req) => {
  const token = config.get('token');
  const companyId = config.get('companyId');
  if (token) req.headers.Authorization = `Bearer ${token}`;
  if (companyId) req.headers['x-company-id'] = companyId;
  return req;
});

export { client, config };
