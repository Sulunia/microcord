import { render } from 'preact';
import '7.css/dist/7.css';
import './styles/reset.css';
import './styles/theme.css';
import { TITLE_TAG } from './constants.js';
import { initTheme } from './hooks/use-theme.js';
import { App } from './app.jsx';

initTheme();
document.title = TITLE_TAG;
render(<App />, document.getElementById('app'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
