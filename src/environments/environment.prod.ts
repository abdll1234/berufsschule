export const environment = {
  production: true,
  // ngrok API endpoint for the live backend running on your local machine.
  apiBaseUrl: 'https://nondeficiently-indeterministic-mignon.ngrok-free.dev',
  wsBaseUrl: '',
  // API-only mode in production to avoid WebSocket issues through ngrok free interstitial.
  enableWebSocket: false,
};
