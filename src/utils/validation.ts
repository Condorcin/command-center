export interface ValidationError {
  field: string;
  message: string;
}

export class ValidationException extends Error {
  constructor(public errors: ValidationError[]) {
    super('Validation failed');
    this.name = 'ValidationException';
  }
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 * Minimum 8 characters, at least one letter and one number
 */
export function isValidPassword(password: string): boolean {
  if (password.length < 8) {
    return false;
  }
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasLetter && hasNumber;
}

/**
 * Validate signup request
 */
export function validateSignup(data: unknown): {
  email: string;
  password: string;
} {
  if (typeof data !== 'object' || data === null) {
    throw new ValidationException([
      { field: 'body', message: 'Request body must be an object' },
    ]);
  }

  const body = data as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (typeof body.email !== 'string' || !body.email.trim()) {
    errors.push({ field: 'email', message: 'Email is required' });
  } else if (!isValidEmail(body.email)) {
    errors.push({ field: 'email', message: 'Invalid email format' });
  }

  if (typeof body.password !== 'string' || !body.password.trim()) {
    errors.push({ field: 'password', message: 'Password is required' });
  } else if (!isValidPassword(body.password)) {
    errors.push({
      field: 'password',
      message: 'Password must be at least 8 characters with letters and numbers',
    });
  }

  if (errors.length > 0) {
    throw new ValidationException(errors);
  }

  return {
    email: (body.email as string).trim().toLowerCase(),
    password: body.password as string,
  };
}

/**
 * Validate login request
 */
export function validateLogin(data: unknown): {
  email: string;
  password: string;
} {
  if (typeof data !== 'object' || data === null) {
    throw new ValidationException([
      { field: 'body', message: 'Request body must be an object' },
    ]);
  }

  const body = data as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (typeof body.email !== 'string' || !body.email.trim()) {
    errors.push({ field: 'email', message: 'Email is required' });
  }

  if (typeof body.password !== 'string' || !body.password.trim()) {
    errors.push({ field: 'password', message: 'Password is required' });
  }

  if (errors.length > 0) {
    throw new ValidationException(errors);
  }

  return {
    email: (body.email as string).trim().toLowerCase(),
    password: body.password as string,
  };
}

/**
 * Validate change password request
 */
export function validateChangePassword(data: unknown): {
  currentPassword: string;
  newPassword: string;
} {
  if (typeof data !== 'object' || data === null) {
    throw new ValidationException([
      { field: 'body', message: 'Request body must be an object' },
    ]);
  }

  const body = data as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (typeof body.currentPassword !== 'string' || !body.currentPassword.trim()) {
    errors.push({ field: 'currentPassword', message: 'Current password is required' });
  }

  if (typeof body.newPassword !== 'string' || !body.newPassword.trim()) {
    errors.push({ field: 'newPassword', message: 'New password is required' });
  } else if (!isValidPassword(body.newPassword)) {
    errors.push({
      field: 'newPassword',
      message: 'Password must be at least 8 characters with letters and numbers',
    });
  }

  if (errors.length > 0) {
    throw new ValidationException(errors);
  }

  return {
    currentPassword: body.currentPassword as string,
    newPassword: body.newPassword as string,
  };
}

/**
 * Validate Mercado Libre credentials
 */
export function validateMercadoLibreCredentials(data: unknown): {
  mlUserId: string;
  mlAccessToken: string;
} {
  if (typeof data !== 'object' || data === null) {
    throw new ValidationException([
      { field: 'body', message: 'Request body must be an object' },
    ]);
  }

  const body = data as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (typeof body.mlUserId !== 'string' || !body.mlUserId.trim()) {
    errors.push({ field: 'mlUserId', message: 'Mercado Libre User ID is required' });
  }

  if (typeof body.mlAccessToken !== 'string' || !body.mlAccessToken.trim()) {
    errors.push({ field: 'mlAccessToken', message: 'Mercado Libre Access Token is required' });
  }

  if (errors.length > 0) {
    throw new ValidationException(errors);
  }

  return {
    mlUserId: (body.mlUserId as string).trim(),
    mlAccessToken: (body.mlAccessToken as string).trim(),
  };
}

