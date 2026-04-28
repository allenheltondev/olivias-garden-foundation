import { Amplify } from 'aws-amplify';

export interface AmplifyConfig {
  userPoolId: string;
  userPoolClientId: string;
  region: string;
}

function loadConfig(): AmplifyConfig {
  const userPoolId = import.meta.env.VITE_USER_POOL_ID;
  const userPoolClientId = import.meta.env.VITE_USER_POOL_CLIENT_ID;
  const region = import.meta.env.VITE_AWS_REGION || 'us-east-1';

  if (!userPoolId || !userPoolClientId) {
    throw new Error('Missing sign-in configuration for store app.');
  }

  return {
    userPoolId,
    userPoolClientId,
    region,
  };
}

export function configureAmplify(config?: AmplifyConfig): void {
  const authConfig = config || loadConfig();

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: authConfig.userPoolId,
        userPoolClientId: authConfig.userPoolClientId,
        loginWith: {
          email: true,
        },
      },
    },
  });
}

export function getConfig(): AmplifyConfig {
  return loadConfig();
}
