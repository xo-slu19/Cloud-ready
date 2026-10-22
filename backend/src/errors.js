// Every error response has the same shape so the frontend can handle them in one place:
// { "error": { "code": "SESSION_NOT_FOUND", "message": "...", "details": ... } }

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function parseBody(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(body)',
      message: issue.message,
    }));
    throw new ApiError(400, 'VALIDATION_ERROR', 'Some fields in the request are missing or invalid.', details);
  }
  return result.data;
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'ROUTE_NOT_FOUND', message: `There is no endpoint for ${req.method} ${req.path}.` },
  });
}

// Express recognises error handlers by their four parameters, so `_next` must stay.
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json({ error: body });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' } });
  }

  // Unexpected error: log the details for us, but never send a stack trace to the browser.
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' } });
}
