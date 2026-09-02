import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root — dashboard/index.html did not load correctly.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
