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

// The static <title> describes the product for link previews and search. Once
// we know which route rendered, say which page this actually is.
document.title = isDashboard
  ? 'Audit trail — UPI Agent Trust Layer'
  : 'UPI Agent Trust Layer — policy gatekeeper for agent payments';

createRoot(root).render(<StrictMode>{isDashboard ? <App /> : <Landing />}</StrictMode>);
