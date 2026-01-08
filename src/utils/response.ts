export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

/**
 * Create a success response
 */
export function successResponse<T>(data: T, status = 200): Response {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };
  return Response.json(response, { status });
}

/**
 * Create an error response
 */
export function errorResponse(
  message: string,
  status = 400,
  code?: string,
  details?: unknown
): Response {
  const response: ApiResponse = {
    success: false,
    error: {
      message,
      code,
      details,
    },
  };
  return Response.json(response, { status });
}

/**
 * Handle errors and return appropriate response
 */
export function handleError(error: unknown): Response {
  if (error instanceof Error) {
    // Validation errors
    if (error.name === 'ValidationException') {
      const validationError = error as { errors: Array<{ field: string; message: string }> };
      return errorResponse(
        'Validation failed',
        400,
        'VALIDATION_ERROR',
        validationError.errors
      );
    }

    // Database errors (unique constraint, etc.)
    if (error.message.includes('UNIQUE constraint')) {
      return errorResponse('Email already exists', 409, 'DUPLICATE_EMAIL');
    }

    // Generic errors
    return errorResponse(error.message, 500, 'INTERNAL_ERROR');
  }

  return errorResponse('An unexpected error occurred', 500, 'UNKNOWN_ERROR');
}

