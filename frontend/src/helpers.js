export function filterReview(review = [], filter = 'all') {
  if (filter === 'wrong') return review.filter((item) => !item.correct);
  if (filter === 'lucky') return review.filter((item) => item.luckyGuess);
  return review;
}

export function getDomainName(domainId, byDomain = [], topics = []) {
  return byDomain.find((domain) => domain.domain === domainId)?.name
    || topics.find((domain) => domain.id === domainId)?.name
    || domainId
    || 'Unknown domain';
}

export function safeExternalUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function describeReadinessChange(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value > 0) return `+${value} readiness points since your previous quiz`;
  if (value < 0) return `${value} readiness points since your previous quiz`;
  return 'No readiness change since your previous quiz';
}
