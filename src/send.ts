import { renderTemplate, stripLineBreaks } from './template.js';
import type { TemplateVariables } from './template.js';
import type { Provider, RecipientResult, ResolvedAction } from './types.js';

/**
 * Rendering and sending of one action, shared by the switch accessory (SPEC section 7) and the
 * settings UI's Test send (SPEC section 11.2, item 4). Never throws and never logs; callers decide
 * what to log around it.
 */

export interface RenderedAction {
  body: string;
  subject?: string;
}

/** Applies the template variables to the action's body and, for email, its subject (SPEC section 5.6). */
export function renderAction(action: ResolvedAction, vars: TemplateVariables): RenderedAction {
  return {
    body: renderTemplate(action.body, vars),
    subject: action.subject !== undefined ? stripLineBreaks(renderTemplate(action.subject, vars)) : undefined,
  };
}

/**
 * Sends a rendered action through its provider and guarantees exactly one result per recipient,
 * whatever the provider returned. A missing provider or a rejected promise becomes a failure for
 * every recipient.
 */
export async function sendAction(action: ResolvedAction, provider: Provider | undefined, rendered: RenderedAction): Promise<RecipientResult[]> {
  if (!provider) {
    return action.recipients.map((recipient) => ({ recipient, ok: false, error: `provider "${action.providerId}" is not available` }));
  }
  let results: RecipientResult[];
  try {
    results = await provider.send({
      channel: action.channel,
      sender: action.sender,
      recipients: action.recipients,
      subject: rendered.subject,
      body: rendered.body,
      bcc: action.bcc,
    });
  } catch (err) {
    // Providers never throw by contract; treat a rejection as a failure for every recipient.
    const error = err instanceof Error ? err.message : String(err);
    return action.recipients.map((recipient) => ({ recipient, ok: false, error }));
  }
  const byRecipient = new Map(results.map((r) => [r.recipient, r] as const));
  return action.recipients.map((recipient) => byRecipient.get(recipient) ?? { recipient, ok: false, error: 'no result returned by provider' });
}
