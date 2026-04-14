import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Dev-only plugin that serves mock /okra and /okra/stats responses */
function mockOkraApi(): Plugin {
  return {
    name: 'mock-okra-api',
    configureServer(server) {
      server.middlewares.use('/okra/stats', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ total_pins: 5, country_count: 3, contributor_count: 4 }));
      });
      server.middlewares.use('/okra', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          total_count: 5,
          data: [
            { id: '1', display_lat: 38.9, display_lng: -77.0, contributor_name: 'Alice', story_text: 'My DC garden is thriving this year. I started growing okra three summers ago after my grandmother shared her seeds from Georgia. Every morning I check on the plants before work, and there is something deeply grounding about watching them grow taller each day. The neighbors have started asking for tips, and now we have a little okra-growing community on our block.', country: 'United States of America', photo_urls: [] },
            { id: '2', display_lat: 34.0, display_lng: -118.2, contributor_name: 'Bob', story_text: 'LA sunshine makes the okra grow fast. I planted Clemson Spineless in raised beds and they shot up to six feet by August. The trick is consistent watering in the morning and a good layer of mulch to keep the roots cool. I harvest every other day — if you let the pods get too big they get tough. My family eats okra three times a week now and I still have enough to share with the whole street.', country: 'United States of America', photo_urls: [] },
            { id: '3', display_lat: 51.5, display_lng: -0.1, contributor_name: null, story_text: null, country: 'United Kingdom', photo_urls: [] },
            { id: '4', display_lat: -23.5, display_lng: -46.6, contributor_name: 'Carlos', story_text: 'São Paulo okra patch — started small but now it takes up half the backyard.', country: 'Brazil', photo_urls: [] },
            { id: '5', display_lat: 6.5, display_lng: 3.4, contributor_name: 'Amina', story_text: 'Lagos garden going strong.', country: 'Nigeria', photo_urls: [] },
          ]
        }));
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), mockOkraApi()],
  test: {
    environment: 'jsdom',
    globals: true
  }
});
