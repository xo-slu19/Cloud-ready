const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/+$/, '');

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isProgress = (value) => isRecord(value)
  && Number.isInteger(value.answered)
  && Number.isInteger(value.total)
  && typeof value.finished === 'boolean';
const isQuestion = (value) => isRecord(value)
  && typeof value.id === 'string'
  && typeof value.question === 'string'
  && Array.isArray(value.choices)
  && value.choices.every((choice) => isRecord(choice) && typeof choice.id === 'string' && typeof choice.text === 'string');

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(path, { method = 'GET', body, learnerId, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(learnerId ? { 'X-Learner-Id': learnerId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('The quiz server could not be reached. Check that the backend is running and try again.', 0, 'NETWORK_ERROR');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('The server returned an unreadable response. Please try again.', response.status, 'INVALID_RESPONSE');
  }
  if (!isRecord(payload)) {
    throw new ApiError('The server returned an invalid response. Please try again.', response.status, 'INVALID_RESPONSE');
  }
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || `The server returned an error (${response.status}). Please try again.`,
      response.status,
      payload?.error?.code || 'HTTP_ERROR',
    );
  }
  return payload;
}

function validate(payload, condition, responseName) {
  if (!condition(payload)) {
    throw new ApiError(`The quiz server returned invalid ${responseName} data. Please retry or contact the project team.`, 200, 'INVALID_RESPONSE');
  }
  return payload;
}

export const api = {
  async getHealth() {
    const data = await request('/health');
    return validate(data, (value) => value.status === 'ok' && Number.isInteger(value.questions), 'health check');
  },
  async getTopics() {
    const data = await request('/topics');
    return validate(data, (value) => typeof value.notice === 'string'
      && Array.isArray(value.domains)
      && value.domains.every((domain) => isRecord(domain)
        && typeof domain.id === 'string'
        && typeof domain.name === 'string'
        && Number.isInteger(domain.questionCount)
        && Array.isArray(domain.topics)
        && domain.topics.every((topic) => isRecord(topic) && typeof topic.name === 'string' && Number.isInteger(topic.questionCount))), 'topics');
  },
  async getAttempts(learnerId) {
    const data = await request(`/learners/${encodeURIComponent(learnerId)}/attempts`, { learnerId });
    return validate(data, (value) => isRecord(value.stats) && Array.isArray(value.attempts), 'learner history');
  },
  async startSession(options, learnerId) {
    const data = await request('/sessions', { method: 'POST', body: options, learnerId });
    return validate(data, (value) => typeof value.sessionId === 'string' && isQuestion(value.question) && isProgress(value.progress), 'quiz session');
  },
  async getQuestion(sessionId) {
    const data = await request(`/sessions/${encodeURIComponent(sessionId)}/question`);
    return validate(data, (value) => isProgress(value.progress)
      && (value.finished ? value.question === null : isQuestion(value.question)), 'current question');
  },
  async submitAnswer(sessionId, answer) {
    const data = await request(`/sessions/${encodeURIComponent(sessionId)}/answers`, { method: 'POST', body: answer });
    return validate(data, (value) => typeof value.correct === 'boolean'
      && typeof value.correctChoiceId === 'string'
      && typeof value.explanation === 'string'
      && isProgress(value.progress)
      && (value.nextQuestion === null || isQuestion(value.nextQuestion)), 'answer feedback');
  },
  async getResults(sessionId, review = 'all') {
    const data = await request(`/sessions/${encodeURIComponent(sessionId)}/results?review=${review}`);
    return validate(data, (value) => typeof value.sessionId === 'string'
      && Number.isInteger(value.totalQuestions)
      && Number.isInteger(value.answered)
      && Array.isArray(value.review)
      && Array.isArray(value.byDomain), 'quiz results');
  },
};

export function getLearnerId() {
  const storageKey = 'az900-learner-id';
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(storageKey, id);
  }
  return id;
}

export { API_BASE_URL };
