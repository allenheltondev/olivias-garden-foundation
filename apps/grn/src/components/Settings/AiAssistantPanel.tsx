import { getApiEndpoint } from '../../config/amplify';
import { mcpEndpointFor } from '../../config/mcp';

function currentMcpEndpoint(): string | null {
  try {
    return mcpEndpointFor(getApiEndpoint());
  } catch {
    return null;
  }
}

/**
 * How to use a key with an AI assistant: the MCP server lets an assistant
 * read and update your garden, listings and reminders for you, acting as you
 * with the key you give it.
 */
export function AiAssistantPanel() {
  const endpoint = currentMcpEndpoint();

  return (
    <section className="bg-white rounded-lg shadow-md p-6 space-y-3" aria-labelledby="ai-assistant-heading">
      <h3 id="ai-assistant-heading" className="text-lg font-semibold text-gray-900">
        Use with an AI assistant
      </h3>
      <p className="text-sm text-gray-600">
        Assistants that support MCP connectors can work with your garden for you: log a harvest,
        check your reminders, post extra produce to share, or browse what neighbors are offering.
        Create a key for the assistant, then add this server to it with the key as a bearer token.
      </p>
      {endpoint ? (
        <dl className="text-sm space-y-2">
          <div>
            <dt className="text-gray-600">Server address</dt>
            <dd>
              <code className="break-all">{endpoint}</code>
            </dd>
          </div>
          <div>
            <dt className="text-gray-600">Header</dt>
            <dd>
              <code>Authorization: Bearer &lt;your key&gt;</code>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="text-sm text-gray-600">
          The server address isn&apos;t available in this environment. Ask the foundation for it.
        </p>
      )}
      <p className="text-sm text-gray-600">
        The assistant acts as you, with the same access you have in the app. To cut it off, revoke
        its key.
      </p>
    </section>
  );
}

export default AiAssistantPanel;
