import { render } from 'preact';
import '7.css/dist/7.css';
import './styles/reset.css';
import './styles/theme.css';
import { initConfig } from './runtime-config.js';
import { App } from './app.jsx';
import { initTheme } from './hooks/use-theme.js';

(async () => {
  await initConfig();
  initTheme();
  render(<App />, document.getElementById('app'));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
})();
