import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import App from './App';
import { configureAmplify, getConfig } from './config/amplify';
import { consumeSessionFragment } from './auth/sessionTransfer';
import { initializeStoreCloudWatchRum } from './observability/cloudwatchRum';

initializeStoreCloudWatchRum();
configureAmplify();
consumeSessionFragment(getConfig().userPoolClientId);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
