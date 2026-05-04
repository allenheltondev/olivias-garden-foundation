interface AwsRumClientQueue {
  q: Array<{ c: string; p?: unknown }>;
  n: 'cwr';
  i: string;
  v: string;
  r: string;
  c: CloudWatchRumConfig;
}

interface CloudWatchRumConfig {
  allowCookies: boolean;
  enableXRay: boolean;
  endpoint: string;
  guestRoleArn: string;
  identityPoolId: string;
  recordResourceUrl: boolean;
  releaseId: string;
  sessionAttributes: {
    application_environment: string;
    application_release: string;
    application_surface: 'store';
  };
  sessionSampleRate: number;
  telemetries: Array<'performance' | 'errors' | 'http'>;
}

declare global {
  interface Window {
    AwsRumClient?: AwsRumClientQueue;
    cwr?: (command: string, payload?: unknown) => void;
  }
}

const clientScriptUrl =
  import.meta.env.VITE_STORE_CLOUDWATCH_RUM_CLIENT_URL?.trim() ||
  'https://client.rum.us-east-1.amazonaws.com/1.25.0/cwr.js';

function envValue(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function initializeStoreCloudWatchRum(): void {
  if (typeof window === 'undefined' || window.AwsRumClient) {
    return;
  }

  const appMonitorId = envValue(import.meta.env.VITE_STORE_CLOUDWATCH_RUM_APP_MONITOR_ID);
  const identityPoolId = envValue(import.meta.env.VITE_STORE_CLOUDWATCH_RUM_IDENTITY_POOL_ID);
  const guestRoleArn = envValue(import.meta.env.VITE_STORE_CLOUDWATCH_RUM_GUEST_ROLE_ARN);
  const region = envValue(import.meta.env.VITE_STORE_CLOUDWATCH_RUM_REGION);
  const releaseId = envValue(import.meta.env.VITE_STORE_CLOUDWATCH_RUM_RELEASE_ID);
  const environment = envValue(import.meta.env.VITE_APP_ENVIRONMENT);

  if (!appMonitorId || !identityPoolId || !guestRoleArn || !region || !releaseId || !environment) {
    return;
  }

  const config: CloudWatchRumConfig = {
    allowCookies: false,
    enableXRay: false,
    endpoint: `https://dataplane.rum.${region}.amazonaws.com`,
    guestRoleArn,
    identityPoolId,
    recordResourceUrl: false,
    releaseId,
    sessionAttributes: {
      application_environment: environment,
      application_release: releaseId,
      application_surface: 'store',
    },
    sessionSampleRate: 1,
    telemetries: ['performance', 'errors', 'http'],
  };

  const queue: AwsRumClientQueue = {
    q: [],
    n: 'cwr',
    i: appMonitorId,
    v: releaseId,
    r: region,
    c: config,
  };

  window.AwsRumClient = queue;
  window.cwr = (command, payload) => {
    queue.q.push({ c: command, p: payload });
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = clientScriptUrl;

  document.head.insertBefore(script, document.getElementsByTagName('script')[0] ?? null);
}
