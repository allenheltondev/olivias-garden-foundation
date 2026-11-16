import { Link } from 'react-router-dom';
import { SectionHeading } from '@olivias/ui';
import { AiAssistantPanel } from '../components/Settings/AiAssistantPanel';
import { ApiKeysPanel } from '../components/Settings/ApiKeysPanel';

/**
 * A page of its own rather than a strip inside Settings: creating a key, using
 * it with your own tools or an AI assistant, and revoking it later is more
 * than fits under a profile form. Keys are self-serve, so there is no access
 * request to wait on.
 */
export function ApiKeysPage() {
  return (
    <section className="grn-section grn-api-keys-page">
      <SectionHeading
        title="API keys"
        body="Build your own tools on top of your garden, or let an AI assistant work with it for you. A key acts as you, so treat it like a password."
      />

      <p className="grn-api-keys-page__reference">
        New to the API? The <Link to="/settings/api-keys/reference">API reference</Link> lists
        every endpoint, what it returns, and which ones need no key at all.
      </p>

      <ApiKeysPanel />
      <AiAssistantPanel />
    </section>
  );
}

export default ApiKeysPage;
