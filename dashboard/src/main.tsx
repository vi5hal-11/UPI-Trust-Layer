import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import Landing from '@/Landing';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root — dashboard/index.html did not load correctly.');

/**
 * Two routes do not justify a router dependency.
 *
 * `/` is the landing page a recruiter or judge arrives on; `/dashboard` is the
 * tool. Express serves index.html for both, so a refresh on /dashboard works.
 */
const isDashboard = window.location.pathname.replace(/\/+$/, '') === '/dashboard';

createRoot(root).render(<StrictMode>{isDashboard ? <App /> : <Landing />}</StrictMode>);
