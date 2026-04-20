export function extractAuthContext(event) {
  const authorizer = event?.requestContext?.authorizer ?? {};
  const userId = authorizer.userId ?? authorizer?.lambda?.userId;

  if (!userId) {
    throw new Error('Missing userId in authorizer context');
  }

  const isAdminRaw = authorizer.isAdmin ?? authorizer?.lambda?.isAdmin;

  return {
    userId,
    isAdmin: String(isAdminRaw ?? '').toLowerCase() === 'true'
  };
}

export function requireAdmin(context) {
  if (!context.isAdmin) {
    throw new Error('Forbidden: This feature is only available to administrators');
  }
}
