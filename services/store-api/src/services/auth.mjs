export function extractAuthContext(event) {
  const authorizer = event?.requestContext?.authorizer ?? {};
  const userId = authorizer.userId ?? authorizer?.lambda?.userId ?? null;
  const isAdminRaw = authorizer.isAdmin ?? authorizer?.lambda?.isAdmin;
  const email = authorizer.email ?? authorizer?.lambda?.email ?? null;

  return {
    userId: typeof userId === 'string' && userId.length > 0 && userId !== 'anonymous' ? userId : null,
    email: typeof email === 'string' && email.length > 0 ? email : null,
    isAdmin: String(isAdminRaw ?? '').toLowerCase() === 'true'
  };
}

export function requireUser(context) {
  if (!context.userId) {
    throw new Error('Authentication required');
  }
}

export function requireAdmin(context) {
  if (!context.isAdmin) {
    throw new Error('Forbidden: This feature is only available to administrators');
  }
}
