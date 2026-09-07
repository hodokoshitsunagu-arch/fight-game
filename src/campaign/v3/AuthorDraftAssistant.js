import { authorDraftRequestError } from './AuthorDraftRequest.js';

function cleanRequest(input) {
  return {
    brief: structuredClone(input?.brief ?? {}),
    sourceSummaries: [...(input?.sourceSummaries ?? [])],
    shortReferences: [...(input?.shortReferences ?? [])],
  };
}

export class AuthorDraftAssistant {
  constructor({ request }) {
    this.request = request;
  }

  async generate(input) {
    if (typeof this.request !== 'function') throw new Error('AI draft gateway is not configured');
    const payload = cleanRequest(input);
    const requestError = authorDraftRequestError(payload);
    if (requestError) throw new Error(requestError);
    const result = await this.request(payload);
    if (!result?.content) throw new Error('AI draft gateway returned no content');
    return {
      id: globalThis.crypto?.randomUUID?.() ?? `draft-${Date.now()}`,
      content: result.content,
      provenance: {
        kind: 'ai-draft',
        reviewStatus: 'unreviewed',
        humanEdited: false,
      },
    };
  }

  accept(draft, { content, reviews }) {
    if (!content?.trim() || content.trim() === draft.content.trim()) {
      throw new Error('A human must edit the AI draft before acceptance');
    }
    const gates = ['facts', 'copyrightSimilarity', 'culture', 'gameplay'];
    if (!reviews || !gates.every((gate) => reviews[gate] === true)) {
      throw new Error('All four review gates must pass before AI draft acceptance');
    }
    return {
      ...structuredClone(draft),
      content,
      provenance: {
        ...structuredClone(draft.provenance),
        reviewStatus: 'human-accepted',
        humanEdited: true,
        reviews: structuredClone(reviews),
      },
    };
  }
}
