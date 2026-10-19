import { createRoot } from 'react-dom/client';

import 'dockview-react/dist/styles/dockview.css';
import '@xterm/xterm/css/xterm.css';
import './styles/theme.css';
import './styles/global.css';

import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

// No StrictMode: dockview, xterm and the plugin host all own imperative resources that
// a double-invoked effect would duplicate.
createRoot(container).render(<App />);
