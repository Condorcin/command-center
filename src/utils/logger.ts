/**
 * Logger utility with log levels
 * In production, only logs errors and warnings
 * In development, logs everything
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (message: string, ...args: any[]) => void;
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
}

class LoggerImpl implements Logger {
  private isDevelopment: boolean;

  constructor() {
    // Default to production mode (false) for security and performance
    // In production, only errors and warnings are logged
    // To enable debug/info logs, call logger.setDevelopmentMode(true) or set ENVIRONMENT=development
    this.isDevelopment = false;
  }

  /**
   * Set development mode
   * Call this method to enable debug/info logs in development
   * @param enabled - true to enable development mode, false for production
   */
  setDevelopmentMode(enabled: boolean): void {
    this.isDevelopment = enabled;
  }

  /**
   * Initialize logger with environment configuration
   * @param env - Environment object from Cloudflare Workers (can contain ENVIRONMENT variable)
   */
  initialize(env?: { ENVIRONMENT?: string; NODE_ENV?: string }): void {
    const envValue = env?.ENVIRONMENT || env?.NODE_ENV;
    this.isDevelopment = envValue === 'development' || envValue === 'dev';
  }

  private shouldLog(level: LogLevel): boolean {
    // Always log errors and warnings
    if (level === 'error' || level === 'warn') {
      return true;
    }
    // Only log debug/info in development
    return this.isDevelopment;
  }

  private formatMessage(level: LogLevel, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message), ...args);
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message), ...args);
    }
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage('warn', message), ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage('error', message), ...args);
  }
}

// Export singleton instance
export const logger = new LoggerImpl();

