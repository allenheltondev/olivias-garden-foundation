import { randomUUID } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

interface MockReq {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  on: (event: 'data' | 'end', listener: (...args: unknown[]) => void) => void;
}

interface MockRes {
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
  statusCode?: number;
}

function mockOkraApi(): Plugin {
  const registerMocks = (middlewares: {
    use: (path: string, handler: (req: MockReq, res: MockRes) => void) => void;
  }) => {
    middlewares.use('/api/okra/stats', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ total_pins: 5, country_count: 3, contributor_count: 4, seed_packets_sent: 28 }));
    });

    middlewares.use('/api/okra', (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          total_count: 5,
          data: [
            {
              id: '1',
              display_lat: 38.9,
              display_lng: -77.0,
              contributor_name: 'Alice',
              story_text:
                'My DC garden is thriving this year. I started growing okra three summers ago after my grandmother shared her seeds from Georgia.',
              country: 'United States of America',
              photo_urls: [],
            },
            {
              id: '2',
              display_lat: 34.0,
              display_lng: -118.2,
              contributor_name: 'Bob',
              story_text:
                'LA sunshine makes the okra grow fast. I planted Clemson Spineless in raised beds and now half the block talks about okra.',
              country: 'United States of America',
              photo_urls: [],
            },
            {
              id: '3',
              display_lat: 51.5,
              display_lng: -0.1,
              contributor_name: null,
              story_text: null,
              country: 'United Kingdom',
              photo_urls: [],
            },
            {
              id: '4',
              display_lat: -23.5,
              display_lng: -46.6,
              contributor_name: 'Carlos',
              story_text: 'Sao Paulo okra patch started small but now it takes up half the backyard.',
              country: 'Brazil',
              photo_urls: [],
            },
            {
              id: '5',
              display_lat: 6.5,
              display_lng: 3.4,
              contributor_name: 'Amina',
              story_text: 'Lagos garden going strong.',
              country: 'Nigeria',
              photo_urls: [],
            },
          ],
        }),
      );
    });

    middlewares.use('/api/mock-photo-upload', (req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.statusCode = 200;
        res.end();
      });
    });

    middlewares.use('/api/photos', (req, res) => {
      const photoId = randomUUID();
      const hostHeader = req.headers?.host;
      const host = Array.isArray(hostHeader) ? hostHeader[0] : (hostHeader ?? 'localhost:4174');
      const uploadUrl = `http://${host}/api/mock-photo-upload/${photoId}`;
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ photoId, uploadUrl, method: 'PUT', headers: {}, expiresInSeconds: 900 }));
    });

    middlewares.use('/api/submissions', (_req, res) => {
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });

    middlewares.use('/api/requests', (_req, res) => {
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        requestId: '00000000-0000-0000-0000-000000000000',
        createdAt: new Date().toISOString(),
      }));
    });
  };

  return {
    name: 'mock-okra-api',
    configureServer(server) {
      registerMocks(server.middlewares);
    },
    configurePreviewServer(server) {
      registerMocks(server.middlewares);
    }
  };
}

export default defineConfig({
  plugins: [react(), mockOkraApi()],
  server: {
    host: true,
    port: 4174,
  },
  preview: {
    host: true,
    port: 4174,
  },
});
