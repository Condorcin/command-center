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
    // In Cloudflare Workers, we don't have process.env
    // Logs are controlled by log level - debug/info only in development
    // For production, set this to false to disable debug/info logs
    this.isDevelopment = true; // Set to true for development debugging
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

