import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Fonts are self-hosted from npm packages: no requests to third-party font servers.
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import '@fontsource-variable/dm-sans/opsz.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/globals.css';
import './styles/udyam-verify.css';
import ReportApp from './components/ReportApp';
createRoot(document.getElementById('root')).render(<StrictMode>
    <ReportApp />
  </StrictMode>);
