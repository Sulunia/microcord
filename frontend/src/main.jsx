import { render } from 'preact';
import '7.css/dist/7.css';
import './styles/reset.css';
import './styles/theme.css';
import { TITLE_TAG } from './constants.js';
import { App } from './app.jsx';

document.title = TITLE_TAG;
render(<App />, document.getElementById('app'));
