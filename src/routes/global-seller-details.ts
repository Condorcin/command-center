import { requireAuth } from '../middlewares/auth';
import { GlobalSellerService } from '../services/global-seller.service';
import { GlobalSellerRepository } from '../repositories/global-seller.repository';
import { MercadoLibreAPIService } from '../services/mercado-libre-api.service';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { AuthService } from '../services/auth.service';
import { errorResponse } from '../utils/response';
import { logger } from '../utils/logger';

export interface Env {
  DB: D1Database;
}

/**
 * GET /dashboard/global-seller/:id
 * View details of a Global Seller
 */
export async function globalSellerDetailsHandler(request: Request, env: Env): Promise<Response> {
  try {
    logger.info('[GLOBAL SELLER DETAILS] Starting handler');
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    logger.info('[GLOBAL SELLER DETAILS] Authenticating user...');
    const user = await requireAuth(request, env, authService);
    logger.info('[GLOBAL SELLER DETAILS] User authenticated:', user.id);

    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    logger.info('[GLOBAL SELLER DETAILS] Global Seller ID:', id);

    if (!id) {
      logger.warn('[GLOBAL SELLER DETAILS] Missing Global Seller ID');
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    logger.info('[GLOBAL SELLER DETAILS] Fetching global seller...');
    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      logger.warn('[GLOBAL SELLER DETAILS] Global Seller not found:', id);
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    logger.info('[GLOBAL SELLER DETAILS] Global Seller found:', globalSeller.id);

    // Verify ownership
    if (globalSeller.user_id !== user.id) {
      logger.warn('[GLOBAL SELLER DETAILS] Access denied for user:', user.id, 'Global Seller:', globalSeller.id);
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

    logger.info('[GLOBAL SELLER DETAILS] Generating HTML...');

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Detalles del Global Seller - Orbix</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    :root {
      --bg-primary: #ffffff;
      --bg-secondary: #f9fafb;
      --bg-tertiary: #f3f4f6;
      --text-primary: #111827;
      --text-secondary: #6b7280;
      --border-color: #e5e7eb;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --sidebar-bg: #1f2937;
      --sidebar-text: #f9fafb;
      --sidebar-hover: #374151;
    }
    
    [data-theme="dark"] {
      --bg-primary: #111827;
      --bg-secondary: #1f2937;
      --bg-tertiary: #374151;
      --text-primary: #f9fafb;
      --text-secondary: #d1d5db;
      --border-color: #4b5563;
      --sidebar-bg: #0f172a;
      --sidebar-text: #f9fafb;
      --sidebar-hover: #1e293b;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: var(--bg-secondary);
      color: var(--text-primary);
      transition: background-color 0.3s, color 0.3s;
    }
    
    .app-container {
      display: flex;
      min-height: 100vh;
    }
    
    /* Sidebar */
    .sidebar {
      width: 260px;
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      padding: 24px;
      display: flex;
      flex-direction: column;
      position: fixed;
      height: 100vh;
      overflow-y: auto;
      transition: transform 0.3s;
    }
    
    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .logo-icon {
      width: 40px;
      height: 40px;
      position: relative;
    }
    
    .logo-icon::before {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle at 30% 30%, #3b82f6, #1e40af);
      border-radius: 50%;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    }
    
    .logo-icon::after {
      content: '';
      position: absolute;
      width: 120%;
      height: 120%;
      top: -10%;
      left: -10%;
      border: 2px solid rgba(59, 130, 246, 0.3);
      border-radius: 50%;
      border-top-color: rgba(59, 130, 246, 0.8);
      animation: orbit 3s linear infinite;
    }
    
    @keyframes orbit {
      to { transform: rotate(360deg); }
    }
    
    .logo-text {
      font-size: 20px;
      font-weight: 700;
      color: var(--sidebar-text);
    }
    
    .nav-menu {
      list-style: none;
      flex: 1;
    }
    
    .nav-item {
      margin-bottom: 8px;
    }
    
    .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      color: var(--sidebar-text);
      text-decoration: none;
      border-radius: 8px;
      transition: background-color 0.2s;
      cursor: pointer;
      opacity: 0.8;
    }
    
    .nav-link:hover {
      background: var(--sidebar-hover);
      opacity: 1;
    }
    
    .nav-link.active {
      background: var(--sidebar-hover);
      opacity: 1;
      font-weight: 600;
    }
    
    .nav-icon {
      width: 20px;
      height: 20px;
    }
    
    .sidebar-footer {
      padding-top: 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .user-info {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.05);
    }
    
    .user-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      color: white;
    }
    
    .user-details {
      flex: 1;
      min-width: 0;
    }
    
    .user-email {
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .user-role {
      font-size: 12px;
      opacity: 0.7;
      text-transform: capitalize;
    }
    
    /* Main Content */
    .main-content {
      flex: 1;
      margin-left: 260px;
      padding: 32px;
      max-width: calc(100vw - 260px);
    }
    
    .content-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
    }
    
    .page-title {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
    }
    
    .container {
      max-width: 100%;
    }
    
    .info-card {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    .card-title {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 16px;
      color: var(--text-primary);
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
    }
    
    .card-header-collapsible {
      cursor: pointer;
      user-select: none;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 16px;
    }
    
    .card-header-collapsible:hover {
      opacity: 0.8;
    }
    
    .info-section-content {
      display: block;
      animation: slideDown 0.3s ease-out;
    }
    
    @keyframes slideDown {
      from {
        opacity: 0;
        max-height: 0;
        overflow: hidden;
      }
      to {
        opacity: 1;
        max-height: 5000px;
      }
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .seller-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
    }
    
    .seller-header-left {
      flex: 1;
    }
    
    .seller-name {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      margin-bottom: 4px;
      line-height: 1.3;
    }
    
    .seller-identifier {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    
    .seller-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 16px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: #d1fae5;
      color: #065f46;
    }
    
    [data-theme="dark"] .seller-badge {
      background: #064e3b;
      color: #6ee7b7;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }
    
    @media (max-width: 1200px) {
      .info-grid {
        grid-template-columns: repeat(3, 1fr);
        gap: 14px;
      }
    }
    
    @media (max-width: 768px) {
      .info-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }
    }
    
    @media (max-width: 480px) {
      .info-grid {
        grid-template-columns: 1fr;
        gap: 10px;
      }
    }
    
    .info-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 0;
    }
    
    .info-icon {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      color: var(--accent);
      margin-top: 2px;
    }
    
    .info-content {
      flex: 1;
      min-width: 0;
    }
    
    .info-label {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-secondary);
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    
    .info-value {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      word-break: break-word;
      line-height: 1.3;
    }
    
    .info-value.empty {
      color: var(--text-secondary);
      font-style: italic;
    }
    
    .info-value.monospace {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 11px;
      background: var(--bg-tertiary);
      padding: 2px 5px;
      border-radius: 4px;
      display: inline-block;
    }
    
    .info-section-divider {
      grid-column: 1 / -1;
      height: 1px;
      background: var(--border-color);
      margin: 12px 0;
    }
    
    .info-section-title {
      grid-column: 1 / -1;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-secondary);
      letter-spacing: 0.5px;
      margin: 12px 0 10px 0;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }
    
    .table-container {
      overflow-x: auto;
      margin-top: 16px;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-primary);
    }
    
    table thead {
      background: var(--bg-tertiary);
    }
    
    table th {
      padding: 12px;
      text-align: left;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-secondary);
      border-bottom: 2px solid var(--border-color);
    }
    
    table th.sortable {
      cursor: pointer;
      user-select: none;
      position: relative;
      padding-right: 24px;
    }
    
    table th.sortable:hover {
      background: var(--bg-secondary);
    }
    
    table th.sortable .sort-icon {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      opacity: 0.5;
      font-size: 10px;
    }
    
    table th.sortable.sorted-asc .sort-icon::after {
      content: '▲';
      opacity: 1;
    }
    
    table th.sortable.sorted-desc .sort-icon::after {
      content: '▼';
      opacity: 1;
    }
    
    table td {
      padding: 12px;
      border-bottom: 1px solid var(--border-color);
    }
    
    table tbody tr:hover {
      background: var(--bg-secondary);
    }
    
    .country-flags {
      display: flex;
      gap: 4px;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .country-flag {
      font-size: 20px;
      line-height: 1;
      cursor: help;
      position: relative;
    }
    
    .country-flag:hover::after {
      content: attr(data-country);
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: var(--bg-primary);
      color: var(--text-primary);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      border: 1px solid var(--border-color);
      margin-bottom: 4px;
      z-index: 10;
    }
    
    .error-icon {
      cursor: pointer;
      color: #ef4444;
      font-size: 18px;
      opacity: 0.7;
      transition: opacity 0.2s;
      display: inline-block;
    }
    
    .error-icon:hover {
      opacity: 1;
    }
    
    .error-icon.hidden {
      display: none;
    }
    
    .error-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    
    .error-modal.show {
      display: flex;
    }
    
    .error-modal-content {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    }
    
    .error-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
    }
    
    .error-modal-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
    }
    
    .error-modal-close {
      background: none;
      border: none;
      font-size: 24px;
      color: var(--text-secondary);
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background 0.2s;
    }
    
    .error-modal-close:hover {
      background: var(--bg-secondary);
    }
    
    .error-modal-body {
      color: var(--text-primary);
    }
    
    .error-detail {
      margin-bottom: 12px;
    }
    
    .error-detail-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    
    .error-detail-value {
      font-size: 14px;
      color: var(--text-primary);
      word-break: break-word;
      font-family: monospace;
      background: var(--bg-tertiary);
      padding: 8px;
      border-radius: 4px;
    }
    
    /* Performance Modal Styles */
    .performance-modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1001;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .performance-modal.show {
      display: flex;
    }
    
    .performance-modal-content {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      max-width: 900px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    }
    
    .performance-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--border-color);
    }
    
    .performance-modal-title {
      font-size: 20px;
      font-weight: 700;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .performance-score-large {
      font-size: 32px;
      font-weight: 700;
      padding: 8px 16px;
      border-radius: 8px;
      color: white;
    }
    
    .performance-level-badge {
      font-size: 14px;
      padding: 6px 12px;
      border-radius: 6px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .performance-badge {
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .performance-badge:hover {
      transform: scale(1.1);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    
    .performance-bucket {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
    }
    
    .performance-bucket-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .performance-bucket-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .performance-bucket-score {
      font-size: 18px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 6px;
      color: white;
    }
    
    .performance-variable {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 12px;
    }
    
    .performance-variable-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    
    .performance-variable-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }
    
    .performance-variable-score {
      font-size: 14px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      color: white;
    }
    
    .performance-rule {
      background: var(--bg-tertiary);
      border-left: 3px solid var(--border-color);
      border-radius: 4px;
      padding: 10px;
      margin-bottom: 8px;
    }
    
    .performance-rule.pending {
      border-left-color: #f59e0b;
    }
    
    .performance-rule.completed {
      border-left-color: #10b981;
    }
    
    .performance-rule-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      margin-bottom: 4px;
    }
    
    .performance-rule-link {
      display: inline-block;
      margin-top: 6px;
      padding: 6px 12px;
      background: var(--accent);
      color: white;
      text-decoration: none;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      transition: background 0.2s;
    }
    
    .performance-rule-link:hover {
      background: var(--accent-hover);
    }
    
    .performance-progress-bar {
      width: 100%;
      height: 6px;
      background: var(--bg-tertiary);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 6px;
    }
    
    .performance-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent-hover));
      transition: width 0.3s;
    }
    
    .performance-loading {
      text-align: center;
      padding: 40px;
      color: var(--text-secondary);
    }
    
    .performance-empty {
      text-align: center;
      padding: 40px;
      color: var(--text-secondary);
    }
    
    .alert {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      display: none;
      font-size: 14px;
    }
    
    .alert.show {
      display: block;
    }
    
    .alert-info {
      background: #dbeafe;
      color: #1e40af;
      border: 1px solid #93c5fd;
    }
    
    .alert-success {
      background: #d1fae5;
      color: #065f46;
      border: 1px solid #6ee7b7;
    }
    
    .alert-error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fca5a5;
    }
    
    .alert-warning {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
    
    [data-theme="dark"] .alert-warning {
      background: #78350f;
      color: #fef3c7;
      border-color: #fbbf24;
    }
    
    .progress-container {
      margin-top: 12px;
      width: 100%;
    }
    
    .progress-bar {
      width: 100%;
      height: 8px;
      background: var(--bg-tertiary);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 8px;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--accent-hover));
      border-radius: 4px;
      transition: width 0.3s ease;
      animation: progressPulse 2s ease-in-out infinite;
    }
    
    @keyframes progressPulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }
    
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid rgba(59, 130, 246, 0.3);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-right: 8px;
      vertical-align: middle;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    [data-theme="dark"] .alert-info {
      background: #1e3a8a;
      color: #dbeafe;
      border-color: #3b82f6;
    }
    
    [data-theme="dark"] .alert-success {
      background: #064e3b;
      color: #d1fae5;
      border-color: #10b981;
    }
    
    [data-theme="dark"] .alert-error {
      background: #7f1d1d;
      color: #fee2e2;
      border-color: #ef4444;
    }
    
    .btn {
      padding: 10px 20px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      display: inline-block;
    }
    
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
    }
    
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-sm {
      padding: 6px 12px;
      font-size: 12px;
      min-width: 80px;
    }

    .btn-secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }
    
    .btn-secondary:hover:not(:disabled) {
      background: var(--border-color);
    }
    
    .btn-secondary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .btn-danger {
      background: #ef4444;
      color: white;
    }
    
    .btn-danger:hover:not(:disabled) {
      background: #dc2626;
    }
    
    .btn-danger:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .form-input {
      padding: 8px 12px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 14px;
      background: var(--bg-primary);
      color: var(--text-primary);
      transition: border-color 0.2s;
    }
    
    .form-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .search-input {
      padding: 8px 12px 8px 36px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 14px;
      background: var(--bg-primary);
      color: var(--text-primary);
      transition: border-color 0.2s;
      width: 200px;
      position: relative;
    }
    
    .search-input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    
    .search-container {
      position: relative;
      display: inline-block;
    }
    
    .search-icon {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--text-secondary);
      pointer-events: none;
    }
    
    @media (max-width: 768px) {
      .sidebar {
        transform: translateX(-100%);
      }
      
      .sidebar.open {
        transform: translateX(0);
      }
      
      .main-content {
        margin-left: 0;
        max-width: 100vw;
        padding: 16px;
      }
      
      table {
        font-size: 12px;
      }
      
      table th,
      table td {
        padding: 8px;
      }
    }
  </style>
</head>
<body>
  <div class="app-container">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <div class="logo-icon"></div>
        <div class="logo-text">Orbix</div>
      </div>
      
      <nav>
        <ul class="nav-menu">
          <li class="nav-item">
            <a class="nav-link" href="/dashboard" data-section="dashboard">
              <svg class="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
              </svg>
              Dashboard
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="/dashboard" data-section="settings">
              <svg class="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              Configuración
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link active" href="/dashboard" data-section="mercado-libre">
              <svg class="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
              Mercado Libre
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" href="/dashboard" data-section="user">
              <svg class="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
              </svg>
              Usuario
            </a>
          </li>
        </ul>
      </nav>
      
      <div class="sidebar-footer">
        <div class="user-info">
          <div class="user-avatar">${user.email.charAt(0).toUpperCase()}</div>
          <div class="user-details">
            <div class="user-email">${user.email}</div>
            <div class="user-role">${user.role}</div>
          </div>
        </div>
      </div>
    </aside>
    
    <!-- Main Content -->
    <main class="main-content">
      <div class="content-header">
        <h1 class="page-title">Detalles del Global Seller: ${globalSeller.ml_nickname || globalSeller.name || 'Sin nombre'}</h1>
        <a href="/dashboard" class="btn btn-secondary" style="text-decoration: none;">
          ← Volver
        </a>
      </div>
      
      <div class="container">
    <!-- Información del Global Seller -->
    <div class="info-card">
      <div class="card-header-collapsible" onclick="toggleInfoSection()">
        <h2 class="card-title" style="margin: 0; display: flex; align-items: center; gap: 12px;">
          <svg id="collapseIcon" style="width: 20px; height: 20px; fill: none; stroke: currentColor; transition: transform 0.3s;" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
          </svg>
          Información del Global Seller
        </h2>
      </div>
      <div id="infoSection" class="info-section-content">
        <!-- Header con nombre y badge -->
        <div class="seller-header">
          <div class="seller-header-left">
            <div class="seller-name">
              ${globalSeller.name || `${globalSeller.ml_first_name || ''} ${globalSeller.ml_last_name || ''}`.trim() || globalSeller.ml_nickname || 'Sin nombre'}
            </div>
            <div class="seller-identifier">
              ${globalSeller.ml_nickname ? `<span>@${globalSeller.ml_nickname}</span>` : ''}
              <span>·</span>
              <span>ID: ${globalSeller.ml_user_id || '-'}</span>
            </div>
          </div>
          ${globalSeller.ml_seller_experience ? `
          <div class="seller-badge">${globalSeller.ml_seller_experience}</div>
          ` : ''}
        </div>
        
        <!-- Información en dos columnas -->
        <div class="info-grid">
          <!-- Columna Izquierda -->
          ${globalSeller.ml_email ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Email</div>
              <div class="info-value">${globalSeller.ml_email}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_country_id || globalSeller.ml_site_id ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">País</div>
              <div class="info-value">${globalSeller.ml_country_id || ''}${globalSeller.ml_country_id && globalSeller.ml_site_id ? ' · ' : ''}${globalSeller.ml_site_id || ''}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_first_name || globalSeller.ml_last_name ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Nombre</div>
              <div class="info-value">${`${globalSeller.ml_first_name || ''} ${globalSeller.ml_last_name || ''}`.trim() || 'No disponible'}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_brand_name ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Marca</div>
              <div class="info-value">${globalSeller.ml_brand_name}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_address ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Dirección</div>
              <div class="info-value">${globalSeller.ml_address}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_registration_date ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Registro</div>
              <div class="info-value">${new Date(globalSeller.ml_registration_date).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          ` : ''}
          
          <!-- Columna Derecha -->
          ${globalSeller.ml_phone ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Teléfono</div>
              <div class="info-value">${globalSeller.ml_phone}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_corporate_name ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Razón Social</div>
              <div class="info-value">${globalSeller.ml_corporate_name}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_tax_id ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Tax ID</div>
              <div class="info-value">${globalSeller.ml_tax_id}</div>
            </div>
          </div>
          ` : ''}
          
          ${globalSeller.ml_city || globalSeller.ml_state || globalSeller.ml_zip_code ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Ciudad</div>
              <div class="info-value">${[globalSeller.ml_city, globalSeller.ml_state, globalSeller.ml_zip_code].filter(Boolean).join(', ') || 'No disponible'}</div>
            </div>
          </div>
          ` : ''}
        </div>
        
        <!-- Información del Sistema -->
        <div class="info-section-title">Información del Sistema Orbix</div>
        <div class="info-grid">
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">ID del Global Seller</div>
              <div class="info-value monospace">${globalSeller.id}</div>
            </div>
          </div>
          
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Creado en Orbix</div>
              <div class="info-value">${new Date(globalSeller.created_at * 1000).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Última Actualización</div>
              <div class="info-value">${new Date(globalSeller.updated_at * 1000).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          
          ${globalSeller.ml_info_updated_at ? `
          <div class="info-item">
            <svg class="info-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            <div class="info-content">
              <div class="info-label">Información ML Actualizada</div>
              <div class="info-value">${new Date(globalSeller.ml_info_updated_at * 1000).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
    
    <!-- CBTs Section -->
    <div class="info-card">
      <h2 class="card-title">CBTs (Cross Border Trade)</h2>
      <div id="cbtsSection">
        <div style="margin-bottom: 24px;">
          <div id="cbtsInfo" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px;">
            <!-- Total Items Card -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
              <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600;">
                Total Items
              </div>
              <div style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">
                <span id="totalCBTsCount">-</span>
              </div>
              <div id="itemsBreakdown" style="font-size: 12px; color: var(--text-secondary); display: flex; flex-wrap: wrap; gap: 8px;">
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
                  <span id="itemsActive">-</span> activos
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b;"></span>
                  <span id="itemsPaused">-</span> pausados
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span>
                  <span id="itemsClosed">-</span> cerrados
                </span>
              </div>
            </div>
            
            <!-- CBTs Encontrados Card -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
              <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600;">
                CBTs Guardados
              </div>
              <div style="font-size: 24px; font-weight: 700; color: var(--accent); margin-bottom: 8px;">
                <span id="foundCBTsCount">0</span>
              </div>
              <div id="cbtsSyncBreakdown" style="font-size: 12px; color: var(--text-secondary); display: flex; flex-wrap: wrap; gap: 8px;">
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
                  <span id="cbtsSyncedCount">-</span> sincronizadas
                </span>
                <span style="display: inline-flex; align-items: center; gap: 4px;">
                  <span style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b;"></span>
                  <span id="cbtsNotSyncedCount">-</span> sin sincronizar
                </span>
              </div>
            </div>
            
            <!-- Faltan por traer Card -->
            <div style="background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; padding: 16px;">
              <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; font-weight: 600;">
                Pendientes
              </div>
              <div style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
                <span id="remainingCBTsCount">-</span>
              </div>
              <div style="font-size: 12px; color: var(--text-secondary);">
                Por sincronizar
              </div>
            </div>
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button class="btn btn-primary" onclick="fetchCBTs()" id="fetchCBTsBtn">
              Buscar CBTs
            </button>
            <button class="btn btn-warning" onclick="pauseAutoFetch()" id="pauseCBTsBtn" style="display: none;">
              Pausar
            </button>
            <button class="btn btn-success" onclick="saveCBTs()" id="saveCBTsBtn" style="display: none;">
              Guardar CBTs
            </button>
            <button class="btn btn-secondary" onclick="syncAllCBTs()" id="syncAllCBTsBtn">
              Sync All CBTs
            </button>
            <button class="btn btn-warning" onclick="pauseSyncAllCBTs()" id="pauseSyncAllCBTsBtn" style="display: none;">
              Pausar Sync
            </button>
            <button class="btn btn-primary" onclick="resumeSyncAllCBTs()" id="resumeSyncAllCBTsBtn" style="display: none;">
              Reanudar Sync
            </button>
            <button class="btn btn-danger" onclick="stopSyncAllCBTs()" id="stopSyncAllCBTsBtn" style="display: none;">
              Detener Sync
            </button>
            <button class="btn btn-success" onclick="continueSyncCBTs()" id="continueSyncCBTsBtn">
              Continuar Sincronización
            </button>
          </div>
        </div>
        
        <div id="cbtsAlert" class="alert" style="display: none;"></div>
        
        <!-- Progress Bar -->
        <div id="cbtsProgressContainer" style="display: none; margin: 16px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; color: var(--text-secondary);">
            <span id="progressText">Sincronizando...</span>
            <span id="progressPercent">0%</span>
            </div>
          <div style="width: 100%; height: 24px; background: var(--bg-tertiary); border-radius: 12px; overflow: hidden; position: relative;">
            <div id="progressBar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #3b82f6, #8b5cf6); transition: width 0.3s ease; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: bold;">
          </div>
          </div>
          <div style="margin-top: 8px; font-size: 12px; color: var(--text-secondary); text-align: center;">
            <span id="progressDetails">Iniciando...</span>
          </div>
        </div>
        
        <div id="cbtsTableContainer" style="display: none;">
          <div style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div style="font-size: 14px; color: var(--text-secondary);">
              <span id="paginationInfo">Cargando...</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn btn-secondary" onclick="goToFirstPage()" id="firstPageBtn" style="padding: 6px 12px; font-size: 12px;" disabled>
                ««
              </button>
              <button class="btn btn-secondary" onclick="goToPreviousPage()" id="prevPageBtn" style="padding: 6px 12px; font-size: 12px;" disabled>
                « Anterior
              </button>
              <span style="padding: 0 12px; font-size: 14px; color: var(--text-primary);">
                Página <span id="currentPage">1</span> de <span id="totalPages">1</span>
              </span>
              <button class="btn btn-secondary" onclick="goToNextPage()" id="nextPageBtn" style="padding: 6px 12px; font-size: 12px;" disabled>
                Siguiente »
              </button>
              <button class="btn btn-secondary" onclick="goToLastPage()" id="lastPageBtn" style="padding: 6px 12px; font-size: 12px;" disabled>
                »»
              </button>
            </div>
          </div>
          <div class="table-container">
            <table id="cbtsTable">
              <thead>
                <tr>
                  <th style="width: 60px;">N°</th>
                  <th style="width: 100px;">Image</th>
                  <th style="width: 150px;">CBT</th>
                  <th>Title</th>
                  <th style="width: 120px;">Price</th>
                  <th style="width: 150px;">Category ID</th>
                  <th style="width: 120px;">Sold Quantity</th>
                  <th style="width: 120px;">Status</th>
                  <th style="width: 150px;">Logs</th>
                  <th style="width: 120px;">Acción</th>
                </tr>
              </thead>
              <tbody id="cbtsTableBody">
                <tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-secondary);">Esperando sincronización...</td></tr>
              </tbody>
            </table>
          </div>
            </div>
          </div>
        </div>
    
      </div>
    </main>
  </div>
  
  <script>
    console.log('[INIT] 🚀 Script loading...');
    const globalSellerId = '${globalSeller.id}';
    console.log('[INIT] Global Seller ID:', globalSellerId);
    
    // CBTs data
    let fetchedCBTs = []; // CBTs fetched from ML API
    let scrollId = null;
    let scrollIdStartTime = null; // Track when scroll_id was obtained
    let mlAccessToken = '${globalSeller.ml_access_token}';
    let mlUserId = '${globalSeller.ml_user_id}';
    let isFetching = false;
    let isAutoFetching = false; // Auto-fetch mode
    let isPaused = false; // Pause state
    let autoFetchInterval = null;
    let fetchErrorCount = 0;
    const MAX_ERRORS = 3; // Stop after 3 consecutive errors
    
    // Pagination state
    const ITEMS_PER_PAGE = 200;
    let currentPage = 1;
    let totalCBTsInDB = 0;
    let totalPages = 1;
    let totalCBTsFromML = 0; // Total CBTs from Mercado Libre API
    
    // Get total items count from ML API (used as estimate for total CBTs)
    async function getTotalCBTsCount() {
      try {
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/items/count\`,
          { credentials: 'include' }
        );
        
        if (response.ok) {
        const data = await response.json();
          if (data.success && data.data) {
            // Get total items from ML API
            // Note: In scan_mode, we get all items, so this is an estimate
            // The actual CBT count will be determined during sync
          const mlTotal = data.data.ml_total || 0;
            // Use database count as fallback if ML total is not available
            const dbTotal = data.data.count?.total || 0;
            // Use ml_total if available, otherwise use database total
            const totalToUse = mlTotal > 0 ? mlTotal : dbTotal;
            totalCBTsFromML = totalToUse;
            
            // Use ml_count (from ML API) if available, otherwise fall back to count
            const mlCount = data.data.ml_count || data.data.count || {};
            
            // Update breakdown display (only once, these values don't change)
            const activeEl = document.getElementById('itemsActive');
            const pausedEl = document.getElementById('itemsPaused');
            const closedEl = document.getElementById('itemsClosed');
            
            // Only update if elements exist and values are available
            if (activeEl && mlCount.active !== undefined) {
              activeEl.textContent = mlCount.active.toLocaleString();
            }
            if (pausedEl && mlCount.paused !== undefined) {
              pausedEl.textContent = mlCount.paused.toLocaleString();
            }
            if (closedEl && mlCount.closed !== undefined) {
              closedEl.textContent = mlCount.closed.toLocaleString();
            }
            
            console.log(\`[GET TOTAL] Total: \${totalToUse.toLocaleString()} (ML: \${mlTotal.toLocaleString()}, DB: \${dbTotal.toLocaleString()}, active: \${mlCount.active || 0}, paused: \${mlCount.paused || 0}, closed: \${mlCount.closed || 0})\`);
            
            return totalToUse;
          }
        }
      } catch (error) {
        console.error('Error getting total count:', error);
      }
      return 0;
    }
    
    // Load saved CBTs from database with pagination
    async function loadSavedCBTs(page = 1) {
      try {
        currentPage = page;
        const offset = (page - 1) * ITEMS_PER_PAGE;
        
        console.log(\`[LOAD CBTS] Fetching saved CBTs... Page \${page}, offset: \${offset}\`);
        // First load: fast (without exact sync count)
        // Then load exact count in background
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/saved?limit=\${ITEMS_PER_PAGE}&offset=\${offset}\`,
          { credentials: 'include' }
        );
        
        console.log('[LOAD CBTS] Response status:', response.status);
        
        if (response.ok) {
          let data;
          try {
            data = await response.json();
          } catch (jsonError) {
            console.error('[LOAD CBTS] Error parsing JSON response:', jsonError);
            const text = await response.text();
            console.error('[LOAD CBTS] Response text:', text.substring(0, 500));
            throw new Error('Invalid JSON response from server');
          }
          
          console.log('[LOAD CBTS] Response data:', { 
            success: data.success, 
            cbtsCount: data.data?.cbts?.length, 
            total: data.data?.paging?.total,
            hasData: !!data.data,
            dataKeys: data.data ? Object.keys(data.data) : []
          });
          
          if (data.success && data.data) {
            const cbts = data.data.cbts || [];
            const total = data.data.paging?.total || 0;
            totalCBTsInDB = total;
            totalPages = Math.ceil(total / ITEMS_PER_PAGE);
            
            console.log(\`[LOAD CBTS] Found \${cbts.length} CBTs, total: \${total}, page: \${page}/\${totalPages}\`);
            console.log(\`[LOAD CBTS] 📊 Total CBTs guardados en BD: \${total.toLocaleString()}\`);
            
            // Update counts
            const foundCountEl = document.getElementById('foundCBTsCount');
            if (foundCountEl) {
              foundCountEl.textContent = total.toLocaleString();
              console.log(\`[LOAD CBTS] ✅ Contador actualizado: \${total.toLocaleString()}\`);
            } else {
              console.error('[LOAD CBTS] ❌ foundCBTsCount element not found!');
            }
            
            // Update sync breakdown if available
            if (data.data.syncStats) {
              const syncStats = data.data.syncStats;
              console.log(\`[LOAD CBTS] 📊 Sync breakdown: \${syncStats.synced} synced, \${syncStats.notSynced} not synced\`);
              
              const syncedCountEl = document.getElementById('cbtsSyncedCount');
              const notSyncedCountEl = document.getElementById('cbtsNotSyncedCount');
              
              if (syncedCountEl) {
                syncedCountEl.textContent = syncStats.synced.toLocaleString();
              }
              if (notSyncedCountEl) {
                notSyncedCountEl.textContent = syncStats.notSynced.toLocaleString();
              }
            }
            
            // OPTIMIZATION 2: Lazy loading - conteo exacto se carga después de mostrar la tabla
            // Esto evita bloquear la carga inicial con un COUNT(*) sobre 396k registros
            if (page === 1 && !window.exactSyncCountLoaded) {
              window.exactSyncCountLoaded = true;
              setTimeout(async () => {
                try {
                  // Cargar conteo exacto en background (más lento pero preciso)
                  const exactResponse = await fetch(
                    \`/api/global-sellers/\${globalSellerId}/cbts/saved?limit=\${ITEMS_PER_PAGE}&offset=0&exactSyncCount=true\`,
                    { credentials: 'include' }
                  );
                  if (exactResponse.ok) {
                    const exactData = await exactResponse.json();
                    if (exactData.success && exactData.data?.syncStats) {
                      const exactStats = exactData.data.syncStats;
                      const syncedCountEl = document.getElementById('cbtsSyncedCount');
                      const notSyncedCountEl = document.getElementById('cbtsNotSyncedCount');
                      if (syncedCountEl) syncedCountEl.textContent = exactStats.synced.toLocaleString();
                      if (notSyncedCountEl) notSyncedCountEl.textContent = exactStats.notSynced.toLocaleString();
                    }
                  }
                } catch (error) {
                  console.error('Error loading exact sync count:', error);
                }
              }, 500); // Cargar conteo exacto 500ms después de que la tabla cargue
            }
            
            if (totalCBTsFromML > 0) {
              const remaining = Math.max(0, totalCBTsFromML - total);
              const remainingEl = document.getElementById('remainingCBTsCount');
              if (remainingEl) remainingEl.textContent = remaining.toLocaleString();
            }
            
            // Update pagination info
            updatePaginationInfo(cbts.length, total, page);
            updatePaginationButtons();
            
            // Update table
            const tableBody = document.getElementById('cbtsTableBody');
            if (tableBody) {
              if (cbts.length === 0) {
                if (isAutoFetching) {
                  tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-secondary);"><span class="spinner"></span> Sincronizando CBTs... Los CBTs aparecerán aquí a medida que se encuentren.</td></tr>';
                } else {
                  tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-secondary);">No hay CBTs guardados. Haz clic en "Buscar CBTs" para comenzar.</td></tr>';
                }
              } else {
                // Calculate starting number for this page
                const startNumber = offset + 1;
                tableBody.innerHTML = cbts.map((cbt, index) => {
                  // Status badge styling
                  // Note: If status is 'active' but title/price are null, it means it hasn't been synced yet
                  const getStatusBadge = (status, title, price) => {
                    // If status is 'active' but we don't have title/price, it means it hasn't been synced from ML yet
                    const isNotSynced = status === 'active' && (!title && (price === null || price === undefined));
                    
                    if (!status || isNotSynced) {
                      return '<span style="color: var(--text-secondary); font-style: italic; font-size: 11px;">No sincronizado</span>';
                    }
                    
                    const statusLower = status.toLowerCase();
                    let bgColor, textColor, label;
                    if (statusLower === 'active') {
                      bgColor = '#d1fae5';
                      textColor = '#065f46';
                      label = 'Active';
                    } else if (statusLower === 'paused') {
                      bgColor = '#fef3c7';
                      textColor = '#92400e';
                      label = 'Paused';
                    } else if (statusLower === 'closed') {
                      bgColor = '#fee2e2';
                      textColor = '#991b1b';
                      label = 'Closed';
                    } else {
                      bgColor = 'var(--bg-tertiary)';
                      textColor = 'var(--text-secondary)';
                      label = status;
                    }
                    return \`<span style="background: \${bgColor}; color: \${textColor}; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: capitalize;">\${label}</span>\`;
                  };
                  
                  return \`
                  <tr data-cbt-id="\${cbt.id}">
                    <td style="text-align: center; padding: 8px; font-weight: 600; color: var(--text-secondary);">
                      \${startNumber + index}
                    </td>
                    <td style="text-align: center; padding: 8px;">
                      \${cbt.thumbnail ? \`
                        <img src="\${cbt.thumbnail}" alt="\${cbt.title || cbt.id}" 
                             style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);"
                             onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'60\\'%3E%3Crect fill=\\'%23e5e7eb\\' width=\\'60\\' height=\\'60\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%239ca3af\\' font-size=\\'10\\'%3ENo Image%3C/text%3E%3C/svg%3E';">
                      \` : \`
                        <div style="width: 60px; height: 60px; background: var(--bg-tertiary); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: var(--text-secondary); font-size: 10px;">No Image</div>
                      \`}
                    </td>
                    <td>
                      <code style="background: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace;">
                        \${cbt.id || 'N/A'}
                      </code>
                    </td>
                    <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      \${cbt.title || '<span style="color: var(--text-secondary); font-style: italic;">No title</span>'}
                    </td>
                    <td style="text-align: right; font-weight: 500;">
                      \${cbt.price !== null && cbt.price !== undefined ? \`$\${cbt.price.toFixed(2)}\` : '<span style="color: var(--text-secondary);">-</span>'}
                    </td>
                    <td>
                      <code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 11px; font-family: monospace;">
                        \${cbt.category_id || '<span style="color: var(--text-secondary);">-</span>'}
                      </code>
                    </td>
                    <td style="text-align: center;">
                      \${cbt.sold_quantity !== null && cbt.sold_quantity !== undefined ? cbt.sold_quantity.toLocaleString() : '<span style="color: var(--text-secondary);">-</span>'}
                    </td>
                    <td style="text-align: center;">
                      \${getStatusBadge(cbt.status, cbt.title, cbt.price)}
                    </td>
                    <td style="text-align: center; font-size: 11px;">
                      \${(() => {
                        // OPTIMIZATION 5: Metadata sin parsear - solo se parsea cuando se necesita mostrar
                        // El backend envía metadata como string, aquí lo parseamos solo si es necesario
                        let syncLog = cbt.sync_log;
                        if (!syncLog && cbt.metadata) {
                          try {
                            const metadata = typeof cbt.metadata === 'string' ? JSON.parse(cbt.metadata) : cbt.metadata;
                            syncLog = metadata.sync_log || null;
                          } catch (e) {
                            syncLog = null;
                          }
                        }
                        if (!syncLog) {
                          return '<span style="color: var(--text-secondary); font-style: italic;">-</span>';
                        }
                        if (syncLog === 'OK' || syncLog === 'ok' || syncLog === true) {
                          return '<span style="color: #10b981; font-weight: 600;">✓ OK</span>';
                        }
                        const errorMsg = typeof syncLog === 'string' ? syncLog : (syncLog.error || 'Error');
                        const shortError = errorMsg.length > 30 ? errorMsg.substring(0, 30) + '...' : errorMsg;
                        return \`<span style="color: #ef4444; font-weight: 500; cursor: help;" title="\${errorMsg}">✗ \${shortError}</span>\`;
                      })()}
                    </td>
                    <td style="text-align: center;">
                      <button class="btn btn-sm btn-primary" onclick="syncCBT('\${cbt.id}', this)" 
                              style="padding: 6px 12px; font-size: 12px; min-width: 80px;">
                        <span class="sync-btn-text">Sync</span>
                      </button>
                    </td>
                  </tr>
                \`;
                }).join('');
              }
              console.log(\`[LOAD CBTS] Updated table with \${cbts.length} CBTs\`);
            }
            
            // Always show table (even if empty, so user can see the message)
            const tableContainer = document.getElementById('cbtsTableContainer');
            if (tableContainer) {
              tableContainer.style.display = 'block';
              console.log(\`[LOAD CBTS] Table container displayed (isAutoFetching: \${isAutoFetching}, cbts: \${cbts.length}, total: \${total})\`);
            }
            
            // Return data for functions that need it
            return { cbts, total, page, totalPages };
          } else {
            console.error('[LOAD CBTS] Response not successful:', data);
            // Show error in table
            const tableContainer = document.getElementById('cbtsTableContainer');
            if (tableContainer) {
              tableContainer.style.display = 'block';
            }
            const tableBody = document.getElementById('cbtsTableBody');
            if (tableBody) {
              const errorMsg = data.error?.message || data.message || 'Unknown error';
              tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-secondary);">Error: ' + errorMsg + '</td></tr>';
            }
          }
        } else {
          let errorText;
          try {
            errorText = await response.text();
          } catch (e) {
            errorText = 'Could not read error response';
          }
          console.error('[LOAD CBTS] Response not OK:', response.status, errorText.substring(0, 500));
          // Show error in table
          const tableContainer = document.getElementById('cbtsTableContainer');
          if (tableContainer) {
            tableContainer.style.display = 'block';
          }
          const tableBody = document.getElementById('cbtsTableBody');
          if (tableBody) {
            const statusStr = String(response.status);
            const errorTextSafe = errorText.substring(0, 100).replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const errorHtml = '<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-secondary);">Error ' + statusStr + ': ' + errorTextSafe + '</td></tr>';
            tableBody.innerHTML = errorHtml;
          }
        }
      } catch (error) {
        console.error('[LOAD CBTS] Error loading saved CBTs:', error);
        console.error('[LOAD CBTS] Error details:', {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : 'No stack',
          name: error instanceof Error ? error.name : typeof error
        });
        // Ensure table is shown even on error
        const tableContainer = document.getElementById('cbtsTableContainer');
        if (tableContainer) {
          tableContainer.style.display = 'block';
        }
        const tableBody = document.getElementById('cbtsTableBody');
        if (tableBody) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          const escapedErrorMsg = errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          tableBody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 24px; color: var(--text-secondary);">Error al cargar los CBTs: ' + escapedErrorMsg + '. Por favor, recarga la página o revisa la consola para más detalles.</td></tr>';
        }
      }
      return { cbts: [], total: 0, page: 1, totalPages: 1 };
    }
    
    // Update pagination info display
    function updatePaginationInfo(currentItems, total, page) {
      const paginationInfoEl = document.getElementById('paginationInfo');
      if (paginationInfoEl) {
        const start = (page - 1) * ITEMS_PER_PAGE + 1;
        const end = Math.min(start + currentItems - 1, total);
        paginationInfoEl.textContent = \`Mostrando \${start.toLocaleString()} - \${end.toLocaleString()} de \${total.toLocaleString()} CBTs\`;
      }
      
      const currentPageEl = document.getElementById('currentPage');
      const totalPagesEl = document.getElementById('totalPages');
      if (currentPageEl) currentPageEl.textContent = page;
      if (totalPagesEl) totalPagesEl.textContent = totalPages;
    }
    
    // Update pagination buttons state
    function updatePaginationButtons() {
      const firstBtn = document.getElementById('firstPageBtn');
      const prevBtn = document.getElementById('prevPageBtn');
      const nextBtn = document.getElementById('nextPageBtn');
      const lastBtn = document.getElementById('lastPageBtn');
      
      const canGoPrev = currentPage > 1;
      const canGoNext = currentPage < totalPages;
      
      if (firstBtn) firstBtn.disabled = !canGoPrev;
      if (prevBtn) prevBtn.disabled = !canGoPrev;
      if (nextBtn) nextBtn.disabled = !canGoNext;
      if (lastBtn) lastBtn.disabled = !canGoNext;
    }
    
    // Pagination navigation functions
    function goToFirstPage() {
      if (currentPage > 1) {
        loadSavedCBTs(1);
      }
    }
    
    function goToPreviousPage() {
      if (currentPage > 1) {
        loadSavedCBTs(currentPage - 1);
      }
    }
    
    function goToNextPage() {
      if (currentPage < totalPages) {
        loadSavedCBTs(currentPage + 1);
      }
    }
    
    function goToLastPage() {
      if (currentPage < totalPages) {
        loadSavedCBTs(totalPages);
      }
    }
    
    // Removed calculateEstimatedTime function - no longer needed
    
    // Fetch a single page of CBTs
    async function fetchCBTsPage() {
      if (isFetching) {
        console.log('[FETCH CBTS] Already fetching...');
          return false;
      }

      const fetchBtn = document.getElementById('fetchCBTsBtn');
      const saveBtn = document.getElementById('saveCBTsBtn');
      const alert = document.getElementById('cbtsAlert');
      const tableContainer = document.getElementById('cbtsTableContainer');
      const tableBody = document.getElementById('cbtsTableBody');

      // Check if scroll_id expired (5 minutes = 300000ms)
      const now = Date.now();
      if (scrollId && scrollIdStartTime && (now - scrollIdStartTime) >= 5 * 60 * 1000) {
        console.log('[FETCH CBTS] ⏱️ Scroll ID expired, renewing...');
        scrollId = null;
        scrollIdStartTime = null;
        if (alert) {
          alert.innerHTML = '<span class="spinner"></span> <strong>Scroll ID expirado, renovando...</strong>';
        }
      }

      isFetching = true;

      try {
        console.log('[FETCH CBTS] Fetching page...', { hasScrollId: !!scrollId });
        const fetchUrl = \`/api/global-sellers/\${globalSellerId}/cbts/fetch\${scrollId ? \`?scroll_id=\${scrollId}\` : ''}\`;
        
        const response = await fetch(fetchUrl, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          const errorMsg = errorData.error?.message || response.statusText;
          
          // Check if it's a scroll_id expiration error
          if (errorMsg.includes('scroll_id') || errorMsg.includes('expired') || errorMsg.includes('invalid')) {
            console.log('[FETCH CBTS] ⏱️ Scroll ID error detected, renewing...');
            scrollId = null;
            scrollIdStartTime = null;
            fetchErrorCount++;
            if (fetchErrorCount < MAX_ERRORS) {
              // Retry without scroll_id
              return await fetchCBTsPage();
            }
          }
          
          throw new Error(\`Error: \${errorMsg} (\${response.status})\`);
        }

        const result = await response.json();
        console.log('[FETCH CBTS] Response:', { 
          cbtsCount: result.data?.cbts?.length || 0, 
          hasScrollId: !!result.data?.scroll_id,
          hasMore: result.data?.hasMore 
        });

        if (result.success && result.data) {
          const data = result.data;
          const newCBTs = data.cbts || [];
          
          // Reset error count on success
          fetchErrorCount = 0;
          
          if (newCBTs.length > 0) {
            // Add new CBTs to the list
            fetchedCBTs = [...fetchedCBTs, ...newCBTs];
            
            // Update scroll_id and track when we got it
            if (data.scroll_id && !scrollId) {
              scrollIdStartTime = Date.now();
              console.log('[FETCH CBTS] 🔑 New scroll_id obtained');
            }
            scrollId = data.scroll_id || null;

            // Update table
            if (tableBody) {
              tableBody.innerHTML = fetchedCBTs.map((cbtId, index) => \`
                <tr>
                  <td style="text-align: right; color: var(--text-secondary); font-weight: 500;">
                      \${(index + 1).toLocaleString()}
                    </td>
                    <td>
                      <code style="background: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace;">
                        \${cbtId}
                      </code>
                    </td>
                </tr>
              \`).join('');
            }

            // Update counts
            const foundCountEl = document.getElementById('foundCBTsCount');
            if (foundCountEl) foundCountEl.textContent = fetchedCBTs.length.toLocaleString();

            // Show save button
            if (saveBtn) {
              saveBtn.style.display = 'inline-block';
            }

            const total = data.paging?.total;
            const progress = total ? Math.round((fetchedCBTs.length / total) * 100) : 0;
            
            if (alert) {
              if (isAutoFetching) {
                alert.innerHTML = \`
                  <span class="spinner"></span>
                  <strong>Sincronizando todos los CBTs...</strong> | 
                  <strong>\${fetchedCBTs.length.toLocaleString()}</strong> CBTs encontrados
                  \${total ? \`(\${progress}%)\` : ''}
                  <br><small>\${data.hasMore ? 'Cargando más páginas...' : 'Fin de resultados'}</small>
                \`;
                alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
                alert.classList.add('show', 'alert-info');
              } else {
                alert.innerHTML = \`✅ <strong>\${fetchedCBTs.length} CBTs encontrados</strong>\${total ? \` (de \${total.toLocaleString()} total, \${progress}%)\` : ''}\${data.hasMore ? ' - Hay más páginas disponibles' : ' - Fin de resultados'}\`;
                alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
                alert.classList.add('alert-success');
              }
            }

            console.log(\`[FETCH CBTS] Total CBTs fetched: \${fetchedCBTs.length}\${total ? \` / \${total}\` : ''}\`);
            
            // Return whether there are more pages
            return data.hasMore === true;
          } else {
            if (alert && !isAutoFetching) {
              alert.innerHTML = '⚠️ No se encontraron CBTs en esta página';
              alert.classList.remove('alert-info', 'alert-success', 'alert-error');
              alert.classList.add('alert-warning');
            }
            return false; // No more CBTs
          }
        } else {
          throw new Error(result.error?.message || 'Error al obtener CBTs');
        }

      } catch (error) {
        console.error('[FETCH CBTS] Error:', error);
        fetchErrorCount++;
        
        if (fetchErrorCount >= MAX_ERRORS) {
          // Stop auto-fetching after too many errors
          if (isAutoFetching) {
            stopAutoFetch();
          }
          if (alert) {
            alert.innerHTML = \`✗ <strong>Error:</strong> \${error.message || 'Error al buscar CBTs'} (detenido después de \${MAX_ERRORS} errores)\`;
            alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
            alert.classList.add('alert-error');
          }
          return false;
        }
        
        // For auto-fetch, continue trying
        if (isAutoFetching && fetchErrorCount < MAX_ERRORS) {
          console.log(\`[FETCH CBTS] Error \${fetchErrorCount}/\${MAX_ERRORS}, continuando...\`);
          return true; // Continue trying
        }
        
        if (alert && !isAutoFetching) {
          alert.innerHTML = \`✗ <strong>Error:</strong> \${error.message || 'Error al buscar CBTs'}\`;
        alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
          alert.classList.add('alert-error');
        }
        return false;
      } finally {
        isFetching = false;
      }
    }

    // Pause/Resume auto-fetching
    function pauseAutoFetch() {
      if (!isAutoFetching) return;
      
      isPaused = !isPaused;
      const pauseBtn = document.getElementById('pauseCBTsBtn');
      const alert = document.getElementById('cbtsAlert');
      
      if (pauseBtn) {
        if (isPaused) {
          pauseBtn.textContent = 'Reanudar';
          pauseBtn.classList.remove('btn-warning');
          pauseBtn.classList.add('btn-primary');
          if (alert) {
            alert.innerHTML = '⏸️ <strong>Sincronización pausada.</strong> Haz clic en "Reanudar" para continuar.';
            alert.classList.remove('alert-info', 'alert-success', 'alert-error');
            alert.classList.add('alert-warning');
          }
          console.log('[FETCH CBTS] ⏸️ Paused');
              } else {
          pauseBtn.textContent = 'Pausar';
          pauseBtn.classList.remove('btn-primary');
          pauseBtn.classList.add('btn-warning');
          if (alert) {
            alert.innerHTML = '<span class="spinner"></span> <strong>Sincronizando todos los CBTs...</strong>';
            alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
            alert.classList.add('show', 'alert-info');
          }
          console.log('[FETCH CBTS] ▶️ Resumed');
          // Resume fetching by calling the stored function
          if (fetchNextPageFunction) {
            fetchNextPageFunction();
          }
        }
      }
    }

    // Stop auto-fetching
    function stopAutoFetch() {
      isAutoFetching = false;
      isPaused = false;
      if (autoFetchInterval) {
        clearInterval(autoFetchInterval);
        autoFetchInterval = null;
      }
      
      const fetchBtn = document.getElementById('fetchCBTsBtn');
      const pauseBtn = document.getElementById('pauseCBTsBtn');
      
      if (fetchBtn) {
        fetchBtn.disabled = false;
        fetchBtn.textContent = scrollId ? 'Cargar más CBTs' : 'Buscar CBTs';
        fetchBtn.onclick = fetchCBTs;
      }
      
      if (pauseBtn) {
        pauseBtn.style.display = 'none';
      }
    }

    // Store the fetch function reference
    let fetchNextPageFunction = null;

    // Auto-fetch all CBTs
    async function autoFetchAllCBTs() {
      if (isAutoFetching && !isPaused) {
        console.log('[FETCH CBTS] Already auto-fetching...');
        return;
      }

      const fetchBtn = document.getElementById('fetchCBTsBtn');
      const alert = document.getElementById('cbtsAlert');
      const tableContainer = document.getElementById('cbtsTableContainer');

      // Only initialize if not already running
      if (!isAutoFetching) {
        isAutoFetching = true;
        fetchErrorCount = 0;
        
        if (fetchBtn) {
          fetchBtn.disabled = true;
          fetchBtn.textContent = 'Detener';
          fetchBtn.onclick = stopAutoFetch;
        }

        if (alert) {
          alert.innerHTML = '<span class="spinner"></span> <strong>Sincronizando todos los CBTs...</strong>';
          alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
          alert.classList.add('show', 'alert-info');
          alert.style.display = 'block';
        }

        if (tableContainer) {
          tableContainer.style.display = 'block';
        }

        // Show pause button
        const pauseBtn = document.getElementById('pauseCBTsBtn');
        if (pauseBtn) {
          pauseBtn.style.display = 'inline-block';
          pauseBtn.textContent = 'Pausar';
          pauseBtn.classList.remove('btn-primary');
          pauseBtn.classList.add('btn-warning');
          pauseBtn.onclick = pauseAutoFetch;
        }
      }

      // Start fetching pages automatically
      fetchNextPageFunction = async () => {
        if (!isAutoFetching) {
          return;
        }

        // Check if paused
        if (isPaused) {
          console.log('[FETCH CBTS] ⏸️ Paused, waiting...');
          setTimeout(fetchNextPageFunction, 1000); // Check every second if resumed
          return;
        }

        const hasMore = await fetchCBTsPage();
        
        if (!hasMore) {
          // No more pages, stop and auto-save
          stopAutoFetch();
          if (alert) {
            alert.innerHTML = \`✅ <strong>Búsqueda completada.</strong> \${fetchedCBTs.length.toLocaleString()} CBTs encontrados. Guardando en base de datos...\`;
            alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
                alert.classList.add('alert-success');
          }
          
          // Auto-save CBTs to database
          if (fetchedCBTs.length > 0) {
            console.log(\`[FETCH CBTS] 🔄 Auto-saving \${fetchedCBTs.length} CBTs to database...\`);
            await saveCBTs();
          } else {
            if (alert) {
              alert.innerHTML = '⚠️ No se encontraron CBTs para guardar.';
              alert.classList.remove('alert-success', 'alert-info', 'alert-error');
              alert.classList.add('alert-warning');
            }
          }
        } else {
          // Continue fetching next page after a short delay
          setTimeout(fetchNextPageFunction, 500); // 500ms delay between pages
        }
      };

      // Start fetching (or resume if paused)
      if (!isPaused) {
        await fetchNextPageFunction();
          } else {
        // If paused, just set up the function to resume later
        console.log('[FETCH CBTS] Ready to resume when unpaused');
      }
    }

    // Fetch CBTs - now triggers backend sync
    async function fetchCBTs() {
      console.log('[FETCH CBTS] ⚡⚡⚡ fetchCBTs() FUNCTION CALLED! ⚡⚡⚡');
      console.log('[FETCH CBTS] isFetching:', isFetching, 'isAutoFetching:', isAutoFetching);
      console.log('[FETCH CBTS] globalSellerId:', globalSellerId);
      
      // Stop any previous polling/process before starting a new one
      if (isAutoFetching) {
        console.log('[FETCH CBTS] ⚠️ Stopping previous sync process...');
        isAutoFetching = false;
      }
      
      if (isFetching) {
        console.log('[FETCH CBTS] ⚠️ Previous fetch still in progress, waiting...');
        // Don't return, allow it to continue - the backend will handle concurrent requests
      }

      const fetchBtn = document.getElementById('fetchCBTsBtn');
      const alert = document.getElementById('cbtsAlert');
      const tableContainer = document.getElementById('cbtsTableContainer');

      isFetching = true;
      if (fetchBtn) {
        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Iniciando...';
      }

      if (alert) {
        alert.innerHTML = '<span class="spinner"></span> <strong>Iniciando sincronización automática en el servidor...</strong>';
        alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
        alert.classList.add('show', 'alert-info');
        alert.style.display = 'block';
      }

      if (tableContainer) {
        tableContainer.style.display = 'block';
      }

      try {
        // No limit - sync all CBTs
        const syncUrl = \`/api/global-sellers/\${globalSellerId}/cbts/sync\`;
        
        console.log('[FETCH CBTS] ⚡ Starting backend sync...');
        console.log('[FETCH CBTS] POST URL:', syncUrl);
        console.log('[FETCH CBTS] 📊 Syncing all CBTs (no limit)');
        
        const response = await fetch(
          syncUrl,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          }
        );

        console.log('[FETCH CBTS] Response status:', response.status);

        if (!response.ok) {
          let errorText = '';
          let errorData = null;
          try {
            errorText = await response.text();
            errorData = JSON.parse(errorText);
            console.error('[FETCH CBTS] ❌ Response error:', response.status, errorData);
          } catch (e) {
            console.error('[FETCH CBTS] ❌ Response error (not JSON):', response.status, errorText);
          }
          
          const errorMessage = errorData?.error?.message || errorData?.message || errorText || \`Error \${response.status}\`;
          throw new Error(\`Error \${response.status}: \${errorMessage}\`);
        }

        const data = await response.json();
        console.log('[FETCH CBTS] ✅ Sync started:', data);

        if (data.success) {
          if (alert) {
            alert.innerHTML = '<span class="spinner"></span> <strong>Sincronización iniciada en el servidor</strong><br><small>El proceso continuará incluso si cierras el navegador. Ver el progreso abajo.</small>';
            alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
            alert.classList.add('show', 'alert-info');
          }

          // Show progress bar
          const progressContainer = document.getElementById('cbtsProgressContainer');
          if (progressContainer) {
            progressContainer.style.display = 'block';
          }

          // Start polling to show progress
          isAutoFetching = true;
          startProgressPolling();
        } else {
          throw new Error(data.error?.message || 'Error al iniciar sincronización');
        }

      } catch (error) {
        console.error('[FETCH CBTS] Error:', error);
        console.error('[FETCH CBTS] Error details:', error instanceof Error ? error.stack : String(error));
        
        if (alert) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          let displayMessage = errorMessage;
          
          // Parse error if it's a JSON response
          if (errorMessage.includes('{')) {
            try {
              const errorMatch = errorMessage.match(/\{.*\}/);
              if (errorMatch) {
                const errorObj = JSON.parse(errorMatch[0]);
                displayMessage = errorObj.message || errorObj.error?.message || errorMessage;
              }
            } catch (e) {
              // Keep original message if parsing fails
            }
          }
          
          alert.innerHTML = \`
            ✗ <strong>Error al iniciar sincronización:</strong>
            <br><code style="font-size: 12px; background: rgba(0,0,0,0.1); padding: 4px 8px; border-radius: 4px; display: block; margin-top: 8px;">\${displayMessage}</code>
            <br><small style="margin-top: 8px; display: block;">Revisa la consola del navegador (F12) para más detalles.</small>
          \`;
          alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
          alert.classList.add('show', 'alert-error');
        }
        isAutoFetching = false;
      } finally {
        isFetching = false;
        if (fetchBtn) {
          fetchBtn.disabled = false;
          fetchBtn.textContent = 'Buscar CBTs';
        }
      }
    }

    // Poll for progress
    function startProgressPolling() {
      let pollCount = 0;
      const maxPolls = 3600; // 2 hours max (poll every 2 seconds)
      let lastTotal = 0;
      let noProgressCount = 0;
      const MAX_NO_PROGRESS = 10; // Stop if no progress for 10 polls (20 seconds)
      
      const pollInterval = setInterval(async () => {
        if (!isAutoFetching) {
          clearInterval(pollInterval);
          return;
        }

        pollCount++;
        
        try {
          // Get current count from database
          const { total } = await loadSavedCBTs(currentPage);
          
          const alert = document.getElementById('cbtsAlert');
          const foundCountEl = document.getElementById('foundCBTsCount');
          const progressBar = document.getElementById('progressBar');
          const progressText = document.getElementById('progressText');
          const progressPercent = document.getElementById('progressPercent');
          const progressDetails = document.getElementById('progressDetails');
          
          if (foundCountEl) {
            foundCountEl.textContent = total.toLocaleString();
          }

          // Calculate progress based on total from ML
          const progress = totalCBTsFromML > 0 ? Math.round((total / totalCBTsFromML) * 100) : 0;
          const remaining = totalCBTsFromML > 0 ? Math.max(0, totalCBTsFromML - total) : 0;
          
          // Update progress bar
          if (progressBar) {
            progressBar.style.width = \`\${Math.min(progress, 100)}%\`;
            if (progress > 0) {
              progressBar.textContent = \`\${progress}%\`;
            }
          }
          
          if (progressText) {
            progressText.textContent = \`\${total.toLocaleString()} de \${totalCBTsFromML > 0 ? totalCBTsFromML.toLocaleString() : '?'} CBTs guardados\`;
          }
          
          if (progressPercent) {
            progressPercent.textContent = \`\${progress}%\`;
          }
          
          if (progressDetails) {
            const pagesProcessed = Math.ceil(total / 100);
            const totalPages = totalCBTsFromML > 0 ? Math.ceil(totalCBTsFromML / 100) : 0;
            progressDetails.textContent = \`Página \${pagesProcessed.toLocaleString()}\${totalPages > 0 ? \` de \${totalPages.toLocaleString()}\` : ''} | \${remaining.toLocaleString()} restantes\`;
          }

          // Check if progress stopped
          if (total === lastTotal) {
            noProgressCount++;
            
            // If no progress for a while and we're not at 99% of total, might be token expired or all duplicates
            if (noProgressCount >= MAX_NO_PROGRESS) {
              const progressPercent = totalCBTsFromML > 0 ? (total / totalCBTsFromML) * 100 : 0;
              
              // If we're not close to completion, might be token expired OR all items are duplicates
              if (progressPercent < 99 && remaining > 0) {
                console.warn(\`[PROGRESS] ⚠️ No progress detected after \${MAX_NO_PROGRESS} polls. Progress: \${progressPercent.toFixed(1)}%, Remaining: \${remaining.toLocaleString()}\`);
                console.warn(\`[PROGRESS] ⚠️ This could mean: (1) Token expired, (2) All items are duplicates, or (3) Backend is still processing\`);
                
                // Stop polling
                clearInterval(pollInterval);
                isAutoFetching = false;
                
                if (alert) {
                  alert.innerHTML = \`
                    ⚠️ <strong>La sincronización parece haberse detenido.</strong>
                    <br>Se guardaron <strong>\${total.toLocaleString()}</strong> CBTs hasta ahora.
                    <br>Faltan <strong>\${remaining.toLocaleString()}</strong> CBTs por sincronizar.
                    <br><br>
                    <strong>Posibles causas:</strong>
                    <ul style="text-align: left; margin: 12px 0;">
                      <li><strong>Token expirado (401):</strong> El token de Mercado Libre expiró - necesitas actualizarlo</li>
                      <li><strong>Scroll ID expirado (400):</strong> El scroll_id expiró (cada 5 minutos) - el proceso debería continuar automáticamente</li>
                      <li><strong>Todos los items son duplicados:</strong> Ya fueron sincronizados anteriormente - el proceso continúa buscando nuevos items</li>
                      <li><strong>El proceso continúa en segundo plano:</strong> Puede que no haya nuevos items pero el proceso sigue ejecutándose</li>
                    </ul>
                    <strong>Recomendación:</strong>
                    <ol style="text-align: left; margin: 12px 0;">
                      <li>Verifica en la terminal del backend los logs:
                        <ul style="margin: 4px 0;">
                          <li>Si ves "TOKEN EXPIRED" → Actualiza el token de Mercado Libre</li>
                          <li>Si ves "SCROLL_ID EXPIRED" → El proceso debería continuar automáticamente</li>
                          <li>Si ves "consecutive pages with all duplicates" → El proceso continúa pero todos son duplicados</li>
                        </ul>
                      </li>
                      <li>Si el proceso se detuvo por token expirado, actualiza el token y haz clic en "Buscar CBTs" nuevamente</li>
                      <li>Si el proceso continúa pero no hay progreso, puede ser normal si todos los items son duplicados</li>
                    </ol>
                    <small>La sincronización continuará desde donde se quedó (los CBTs ya guardados no se duplicarán).</small>
                  \`;
                  alert.classList.remove('alert-info', 'alert-success', 'alert-error');
                  alert.classList.add('alert-warning');
                }
                
                return;
              } else {
                // We're close to completion, probably just finished
                console.log(\`[PROGRESS] ✅ Sync appears complete: \${total.toLocaleString()} CBTs guardados (no progress for \${noProgressCount} polls)\`);
                
                // Stop polling
                clearInterval(pollInterval);
                isAutoFetching = false;
                
                // Verify autosave by reloading CBTs
                console.log('[PROGRESS] 🔄 Verificando autoguardado...');
                const { total: finalTotal, cbts } = await loadSavedCBTs(currentPage);
                
                if (alert) {
                  alert.innerHTML = \`
                    ✅ <strong>Sincronización completada exitosamente.</strong>
                    <br>Se guardaron <strong>\${finalTotal.toLocaleString()}</strong> CBTs en la base de datos.
                    <br><small>El autoguardado funcionó correctamente.</small>
                  \`;
                  alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
                  alert.classList.add('alert-success');
                }
                
                console.log(\`[PROGRESS] ✅ Verificación completada: \${finalTotal.toLocaleString()} CBTs en BD\`);
                return;
              }
            }
              } else {
            noProgressCount = 0; // Reset counter if progress detected
            lastTotal = total;
          }

          // Check if we've reached the ML total (or very close, within 1%)
          if (totalCBTsFromML > 0 && total >= totalCBTsFromML * 0.99) {
            console.log(\`[PROGRESS] ✅ Target reached: \${total.toLocaleString()} CBTs guardados (objetivo: \${totalCBTsFromML.toLocaleString()})\`);
            
            // Stop polling
            clearInterval(pollInterval);
            isAutoFetching = false;
            
            // Verify autosave by reloading CBTs
            console.log('[PROGRESS] 🔄 Verificando autoguardado...');
            const { total: finalTotal, cbts } = await loadSavedCBTs(currentPage);
            
            if (alert) {
              alert.innerHTML = \`
                ✅ <strong>Sincronización completada exitosamente.</strong>
                <br>Se guardaron <strong>\${finalTotal.toLocaleString()}</strong> CBTs en la base de datos.
                <br><small>El autoguardado funcionó correctamente.</small>
              \`;
              alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
              alert.classList.add('alert-success');
            }
            
            console.log(\`[PROGRESS] ✅ Verificación completada: \${finalTotal.toLocaleString()} CBTs en BD\`);
            return;
          }

          if (alert) {
            alert.innerHTML = \`
              <span class="spinner"></span>
              <strong>Sincronizando en el servidor...</strong>
              <br><small>El proceso continúa en el servidor. Puedes cerrar esta página y volver más tarde.</small>
            \`;
          }
          
          console.log(\`[PROGRESS] \${total.toLocaleString()} CBTs guardados (\${progress}%) - Faltan \${remaining.toLocaleString()} (sin progreso: \${noProgressCount}/\${MAX_NO_PROGRESS})\`);

          // Stop polling after max time (process should be done by then)
          if (pollCount >= maxPolls) {
            clearInterval(pollInterval);
            isAutoFetching = false;
            if (alert) {
              alert.innerHTML = \`✅ <strong>Sincronización completada (o en curso).</strong> \${total.toLocaleString()} CBTs guardados.\`;
              alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
              alert.classList.add('alert-success');
            }
          }

        } catch (error) {
          console.error('Error polling progress:', error);
        }
      }, 2000); // Poll every 2 seconds
    }

    // Save CBTs to database
    async function saveCBTs() {
      if (fetchedCBTs.length === 0) {
        window.alert('No hay CBTs para guardar. Primero busca CBTs.');
        return;
      }

      const saveBtn = document.getElementById('saveCBTsBtn');
      const alert = document.getElementById('cbtsAlert');

      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Guardando...';
      }

      if (alert) {
        alert.innerHTML = '<span class="spinner"></span> <strong>Guardando CBTs en la base de datos...</strong>';
        alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
      alert.classList.add('show', 'alert-info');
      }
      
      try {
        console.log(\`[SAVE CBTS] Saving \${fetchedCBTs.length} CBTs...\`);
        
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/save\`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ cbts: fetchedCBTs })
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(\`Error: \${response.status} - \${errorText}\`);
        }

          const data = await response.json();
        console.log('[SAVE CBTS] Save response:', data);

          if (data.success) {
          const savedCount = data.data?.saved || fetchedCBTs.length;
          console.log(\`[SAVE CBTS] ✅ Guardados: \${savedCount}, Total enviado: \${fetchedCBTs.length}\`);
          
          if (alert) {
            alert.innerHTML = \`✅ <strong>\${savedCount.toLocaleString()} CBTs guardados exitosamente</strong>\`;
            alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
              alert.classList.add('alert-success');
          }

          // Reload saved CBTs to show updated count
          console.log('[SAVE CBTS] Reloading saved CBTs to update count...');
          const savedResult = await loadSavedCBTs(currentPage);
          console.log(\`[SAVE CBTS] 📊 Total CBTs guardados en BD después de guardar: \${savedResult.total.toLocaleString()}\`);
          } else {
          throw new Error(data.error?.message || 'Error al guardar CBTs');
          }

      } catch (error) {
        console.error('[SAVE CBTS] Error:', error);
        if (alert) {
          alert.innerHTML = \`✗ <strong>Error:</strong> \${error.message || 'Error al guardar CBTs'}\`;
        alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
        alert.classList.add('alert-error');
        }
      } finally {
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Guardar CBTs';
        }
      }
    }

    // Old sync function (kept for compatibility)
    async function syncCBTs() {
      console.log('[SYNC CBTS] ⚡⚡⚡ syncCBTs function CALLED! ⚡⚡⚡');
      console.log('[SYNC CBTS] isSyncingCBTs:', isSyncingCBTs);
      
      if (isSyncingCBTs) {
        console.log('[SYNC CBTS] Already syncing, ignoring...');
        return;
      }

      const syncBtn = document.getElementById('syncCBTsBtn');
      const alert = document.getElementById('cbtsAlert');
      const tableContainer = document.getElementById('cbtsTableContainer');
      
      console.log('[SYNC CBTS] Elements found:', { syncBtn: !!syncBtn, alert: !!alert, tableContainer: !!tableContainer });
      
      isSyncingCBTs = true;
      if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Sincronizando...';
      }
      
      if (alert) {
        alert.innerHTML = '<span class="spinner"></span> <strong>Iniciando sincronización de CBTs...</strong>';
        alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
        alert.classList.add('show', 'alert-info');
        alert.style.display = 'block';
      }
      
      // Show table immediately
      // Show table immediately
      if (tableContainer) {
        tableContainer.style.display = 'block';
        console.log('[SYNC CBTS] Table container shown');
      } else {
        console.error('[SYNC CBTS] Table container not found!');
      }
      
      // Get total count first
      console.log('[SYNC CBTS] Getting total CBTs count...');
      await getTotalCBTsCount();
      const totalCountEl = document.getElementById('totalCBTsCount');
      if (totalCountEl) {
        totalCountEl.textContent = totalCBTsFromML.toLocaleString();
        console.log(\`[SYNC CBTS] Total CBTs from ML: \${totalCBTsFromML}\`);
      } else {
        console.error('[SYNC CBTS] totalCBTsCount element not found!');
      }
      
      syncStartTime = Date.now();
      
      try {
        // Start sync
        console.log('[SYNC CBTS] Starting sync request...');
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/sync\`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          }
        );
        
        console.log('[SYNC CBTS] Sync response status:', response.status);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('[SYNC CBTS] Response error:', response.status, errorText);
          throw new Error(\`Error: \${response.status} - \${response.statusText}\`);
        }
        
        const data = await response.json();
        console.log('[SYNC CBTS] Sync response data:', data);
        
        if (data.success) {
          console.log('[SYNC CBTS] Sync started successfully, starting polling...');
          
          // Start polling for progress
          let lastCount = 0;
          let checkCount = 0;
          const maxChecks = 1800; // 30 minutes max (1 check per 2 seconds)
          
          // Initial load - show table immediately
          console.log('[SYNC CBTS] Initial load of saved CBTs...');
          const initialResult = await loadSavedCBTs(1);
          console.log(\`[SYNC CBTS] Initial load result: \${initialResult.total} CBTs\`);
          
          // Ensure table is visible
          if (tableContainer) {
            tableContainer.style.display = 'block';
          }
          
          syncInterval = setInterval(async () => {
            if (!isSyncingCBTs) {
              clearInterval(syncInterval);
        return;
      }
      
            checkCount++;
            console.log(\`[SYNC CBTS] Polling check #\${checkCount}...\`);
            
            try {
              const { total } = await loadSavedCBTs(currentPage);
              console.log(\`[SYNC CBTS] Current total: \${total}, last count: \${lastCount}\`);
              
              // Removed estimated time calculation - no longer needed
              
              // Update alert with pages info (always update, not just when count increases)
              if (alert) {
                const progress = totalCBTsFromML > 0 ? Math.round((total / totalCBTsFromML) * 100) : 0;
                const itemsPerPage = 100;
                const pagesProcessed = Math.ceil(total / itemsPerPage);
                const totalPages = Math.ceil(totalCBTsFromML / itemsPerPage);
                const pagesRemaining = Math.max(0, totalPages - pagesProcessed);
                
                if (total > lastCount) {
                  lastCount = total;
                  console.log(\`[SYNC CBTS] Count increased to \${total}\`);
                }
                
                // Show different message if no CBTs found yet
                if (total === 0) {
                  alert.innerHTML = \`
                    <span class="spinner"></span>
                    <strong>Sincronizando CBTs...</strong> | 
                    Obteniendo todos los CBTs usando scan mode...
                    <br><small>Esto puede tardar varios minutos. Los CBTs aparecerán en la tabla a medida que se encuentren.</small>
                  \`;
        } else {
                  alert.innerHTML = \`
                    <span class="spinner"></span>
                    <strong>Sincronizando CBTs...</strong> | 
                    <strong>\${total.toLocaleString()}</strong> CBTs encontrados
                    \${totalCBTsFromML > 0 ? \`(\${progress}%)\` : ''}
                    <br><small>Página \${pagesProcessed.toLocaleString()} de \${totalPages.toLocaleString()} (\${pagesRemaining.toLocaleString()} restantes)</small>
                  \`;
                }
              }
              
              // Stop after max checks or if we've found all CBTs
              if (checkCount >= maxChecks || (totalCBTsFromML > 0 && total >= totalCBTsFromML)) {
                clearInterval(syncInterval);
                isSyncingCBTs = false;
                
                if (syncBtn) {
                  syncBtn.disabled = false;
                  syncBtn.textContent = 'Sincronizar CBTs';
                }
                
                if (alert) {
                  alert.innerHTML = \`✅ <strong>Sincronización completada.</strong> \${total.toLocaleString()} CBTs encontrados.\`;
                  alert.classList.remove('alert-info');
                  alert.classList.add('alert-success');
                }
                
                // Final load
                await loadSavedCBTs(currentPage);
              }
            } catch (error) {
              console.error('Error checking sync progress:', error);
            }
          }, 2000); // Check every 2 seconds
          
        } else {
          throw new Error(data.error?.message || 'Error al iniciar sincronización');
        }
      } catch (error) {
        console.error('Error syncing CBTs:', error);
        if (alert) {
          alert.innerHTML = \`✗ <strong>Error:</strong> \${error.message || 'Error al sincronizar CBTs'}\`;
          alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
          alert.classList.add('alert-error');
        }
        isSyncingCBTs = false;
        if (syncBtn) {
          syncBtn.disabled = false;
          syncBtn.textContent = 'Sincronizar CBTs';
        }
      }
    }
    
    // Load initial data
    // OPTIMIZATION 1: Carga paralela - tabla y conteo de ML se cargan simultáneamente
    // La tabla tiene prioridad, pero el conteo de ML no bloquea la carga
    async function loadCBTsData() {
      try {
        // Cargar tabla PRIMERO (más importante para UX)
        const loadTablePromise = loadSavedCBTs(1);
        
        // Cargar conteo de ML en PARALELO (no bloquea la tabla)
        const loadMLCountPromise = getTotalCBTsCount().then(() => {
          const totalCountEl = document.getElementById('totalCBTsCount');
          if (totalCountEl) {
            totalCountEl.textContent = totalCBTsFromML.toLocaleString();
          }
        }).catch((error) => {
          console.error('[LOAD CBTS DATA] Error loading ML count:', error);
          // No romper la página si falla el conteo de ML
        });
        
        // Esperar tabla primero (prioridad)
        await loadTablePromise;
        // Conteo de ML puede cargar en background
        await loadMLCountPromise;
      } catch (error) {
        console.error('[LOAD CBTS DATA] Error loading CBTs data:', error);
        // Ensure table is shown even if there's an error
        const tableContainer = document.getElementById('cbtsTableContainer');
        if (tableContainer) {
          tableContainer.style.display = 'block';
        }
      }
    }
    
    // Load on page load
    loadCBTsData();
    
    // Sync individual CBT
    async function syncCBT(cbtId, buttonEl) {
      const originalText = buttonEl.querySelector('.sync-btn-text')?.textContent || 'Sync';
      const button = buttonEl;
      
      // Disable button and show loading
      button.disabled = true;
      if (buttonEl.querySelector('.sync-btn-text')) {
        buttonEl.querySelector('.sync-btn-text').textContent = 'Syncing...';
      }
      
      try {
        console.log(\`[SYNC CBT] Syncing CBT \${cbtId}...\`);
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/\${cbtId}/sync\`,
          {
            method: 'POST',
            credentials: 'include',
          }
        );
        
        const data = await response.json();
        
        if (data.success) {
          console.log(\`[SYNC CBT] ✅ Successfully synced CBT \${cbtId}\`, data.data);
          
          // Update the row with new data
          const row = document.querySelector(\`tr[data-cbt-id="\${cbtId}"]\`);
          if (row && data.data) {
            // Update image
            const imgCell = row.cells[0];
            if (data.data.image) {
              imgCell.innerHTML = \`<img src="\${data.data.image}" alt="\${data.data.title || cbtId}" 
                                   style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-color);"
                                   onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'60\\' height=\\'60\\'%3E%3Crect fill=\\'%23e5e7eb\\' width=\\'60\\' height=\\'60\\'/%3E%3Ctext x=\\'50%25\\' y=\\'50%25\\' text-anchor=\\'middle\\' dy=\\'.3em\\' fill=\\'%239ca3af\\' font-size=\\'10\\'%3ENo Image%3C/text%3E%3C/svg%3E';">\`;
            }
            
            // Update title
            if (data.data.title) {
              row.cells[2].innerHTML = data.data.title;
            }
            
            // Update price
            if (data.data.price !== null && data.data.price !== undefined) {
              row.cells[3].innerHTML = \`$\${data.data.price.toFixed(2)}\`;
            }
            
            // Update category_id
            if (data.data.category_id) {
              row.cells[4].innerHTML = \`<code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 11px; font-family: monospace;">\${data.data.category_id}</code>\`;
            }
            
            // Update sold_quantity
            if (data.data.sold_quantity !== null && data.data.sold_quantity !== undefined) {
              row.cells[5].innerHTML = data.data.sold_quantity.toLocaleString();
            }
            
            // Update status
            if (data.data.status) {
              const statusLower = data.data.status.toLowerCase();
              let bgColor, textColor, label;
              if (statusLower === 'active') {
                bgColor = '#d1fae5';
                textColor = '#065f46';
                label = 'Active';
              } else if (statusLower === 'paused') {
                bgColor = '#fef3c7';
                textColor = '#92400e';
                label = 'Paused';
              } else if (statusLower === 'closed') {
                bgColor = '#fee2e2';
                textColor = '#991b1b';
                label = 'Closed';
              } else {
                bgColor = 'var(--bg-tertiary)';
                textColor = 'var(--text-secondary)';
                label = data.data.status;
              }
              row.cells[6].innerHTML = \`<span style="background: \${bgColor}; color: \${textColor}; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: capitalize;">\${label}</span>\`;
            }
            
            // Update logs column (cell 7) - success
            if (row.cells[7]) {
              row.cells[7].innerHTML = '<span style="color: #10b981; font-weight: 600;">✓ OK</span>';
            }
          }
          
          // Show success message
          const alert = document.getElementById('cbtsAlert');
          if (alert) {
            alert.innerHTML = \`✅ <strong>CBT \${cbtId} sincronizado exitosamente</strong>\`;
            alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
            alert.classList.add('alert-success');
            alert.style.display = 'block';
            setTimeout(() => {
              alert.style.display = 'none';
            }, 3000);
          }
        } else {
          throw new Error(data.error?.message || 'Error al sincronizar CBT');
        }
      } catch (error) {
        console.error(\`[SYNC CBT] ❌ Error syncing CBT \${cbtId}:\`, error);
        
        // Update logs column with error
        const row = document.querySelector(\`tr[data-cbt-id="\${cbtId}"]\`);
        if (row && row.cells[7]) {
          const errorMsg = error.message || 'Error desconocido';
          const shortError = errorMsg.length > 30 ? errorMsg.substring(0, 30) + '...' : errorMsg;
          row.cells[7].innerHTML = \`<span style="color: #ef4444; font-weight: 500; cursor: help;" title="\${errorMsg}">✗ \${shortError}</span>\`;
        }
        
        // Show error message
        const alert = document.getElementById('cbtsAlert');
        if (alert) {
          alert.innerHTML = \`✗ <strong>Error al sincronizar CBT \${cbtId}:</strong> \${error.message || 'Error desconocido'}\`;
          alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
          alert.classList.add('alert-error');
          alert.style.display = 'block';
          setTimeout(() => {
            alert.style.display = 'none';
          }, 5000);
        }
      } finally {
        // Re-enable button
        button.disabled = false;
        if (buttonEl.querySelector('.sync-btn-text')) {
          buttonEl.querySelector('.sync-btn-text').textContent = originalText;
        }
      }
    }
    
    // Sync all CBTs
    let isSyncingAll = false;
    let syncAllInterval = null;
    
    async function syncAllCBTs() {
      if (isSyncingAll) {
        console.log('[SYNC ALL CBTS] Already syncing all, ignoring...');
        return;
      }
      
      const syncAllBtn = document.getElementById('syncAllCBTsBtn');
      const alert = document.getElementById('cbtsAlert');
      
      // Confirm action
      if (!confirm('¿Estás seguro de que quieres sincronizar TODOS los CBTs? Esto puede tomar mucho tiempo.')) {
        return;
      }
      
      isSyncingAll = true;
      if (syncAllBtn) {
        syncAllBtn.disabled = true;
        syncAllBtn.textContent = 'Sincronizando...';
      }
      
      if (alert) {
        alert.innerHTML = '<span class="spinner"></span> <strong>Iniciando sincronización de todos los CBTs...</strong>';
        alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
        alert.classList.add('show', 'alert-info');
        alert.style.display = 'block';
      }
      
      try {
        console.log('[SYNC ALL CBTS] Starting sync all request...');
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/sync-all\`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
          throw new Error(errorData.error?.message || \`Error: \${response.status}\`);
        }
        
        const data = await response.json();
        console.log('[SYNC ALL CBTS] Sync all started:', data);
        
        if (data.success) {
          // Show control buttons
          const pauseBtn = document.getElementById('pauseSyncAllCBTsBtn');
          const resumeBtn = document.getElementById('resumeSyncAllCBTsBtn');
          const stopBtn = document.getElementById('stopSyncAllCBTsBtn');
          if (pauseBtn) pauseBtn.style.display = 'inline-block';
          if (resumeBtn) resumeBtn.style.display = 'none';
          if (stopBtn) stopBtn.style.display = 'inline-block';
          
          if (alert) {
            alert.innerHTML = \`✅ <strong>Sincronización iniciada.</strong> Sincronizando todos los CBTs en segundo plano...\`;
            alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
            alert.classList.add('alert-success');
          }
          
          // Start polling for progress
          let lastSyncedCount = 0; // Count of CBTs with title/price (synced)
          syncAllInterval = setInterval(async () => {
            try {
              // Reload CBTs to see updated data (this will also update sync stats)
              const result = await loadSavedCBTs(currentPage);
              const cbts = result.cbts || [];
              const totalCBTsCount = result.total || cbts.length;
              
              // Count how many CBTs have been synced (have title or price)
              const syncedCount = cbts.filter(cbt => cbt.title || (cbt.price !== null && cbt.price !== undefined)).length;
              
              // Check if more CBTs were synced
              if (syncedCount > lastSyncedCount) {
                const newlySynced = syncedCount - lastSyncedCount;
                console.log(\`[SYNC ALL CBTS] Progress: \${newlySynced} CBTs synced (total synced: \${syncedCount}/\${totalCBTsCount})\`);
                lastSyncedCount = syncedCount;
              }
              
              // Update alert with progress
              if (alert) {
                const progress = totalCBTsCount > 0 ? ((syncedCount / totalCBTsCount) * 100).toFixed(1) : 0;
                alert.innerHTML = \`<span class="spinner"></span> <strong>Sincronizando todos los CBTs...</strong><br>
                  <small>Progreso: \${syncedCount.toLocaleString()}/\${totalCBTsCount.toLocaleString()} (\${progress}%)</small>\`;
              }
              
              // If all CBTs are synced, stop polling
              if (syncedCount >= totalCBTsCount && totalCBTsCount > 0) {
                console.log('[SYNC ALL CBTS] ✅ All CBTs synced!');
                if (syncAllInterval) {
                  clearInterval(syncAllInterval);
                  syncAllInterval = null;
                }
                isSyncingAll = false;
                
                // Hide control buttons
                const pauseBtn = document.getElementById('pauseSyncAllCBTsBtn');
                const resumeBtn = document.getElementById('resumeSyncAllCBTsBtn');
                const stopBtn = document.getElementById('stopSyncAllCBTsBtn');
                if (pauseBtn) pauseBtn.style.display = 'none';
                if (resumeBtn) resumeBtn.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'none';
                
                if (syncAllBtn) {
                  syncAllBtn.disabled = false;
                  syncAllBtn.textContent = 'Sync All CBTs';
                }
                
                if (alert) {
                  alert.innerHTML = \`✅ <strong>Sincronización completada.</strong> Todos los CBTs han sido sincronizados.\`;
                  alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
                  alert.classList.add('alert-success');
                }
              }
            } catch (error) {
              console.error('[SYNC ALL CBTS] Error checking progress:', error);
            }
          }, 3000); // Check every 3 seconds
          
        } else {
          throw new Error(data.error?.message || 'Error al iniciar sincronización');
        }
      } catch (error) {
        console.error('[SYNC ALL CBTS] Error:', error);
        isSyncingAll = false;
        
        if (syncAllBtn) {
          syncAllBtn.disabled = false;
          syncAllBtn.textContent = 'Sync All CBTs';
        }
        
        if (alert) {
          const errorMsg = error.message || 'Error desconocido';
          
          // Check if it's a token error
          if (errorMsg.includes('401') || errorMsg.includes('token') || errorMsg.includes('unauthorized')) {
            alert.innerHTML = \`🔑 <strong>Token expirado.</strong> Por favor actualiza el token de Mercado Libre y vuelve a intentar.\`;
            alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
            alert.classList.add('alert-error');
            
            // Stop polling if active
            if (syncAllInterval) {
              clearInterval(syncAllInterval);
              syncAllInterval = null;
            }
          } else {
            alert.innerHTML = \`✗ <strong>Error:</strong> \${errorMsg}\`;
            alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
            alert.classList.add('alert-error');
          }
        }
      }
    }
    
    // Pause sync all
    async function pauseSyncAllCBTs() {
      try {
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/sync-all/pause\`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          }
        );
        
        const data = await response.json();
        if (data.success) {
          const pauseBtn = document.getElementById('pauseSyncAllCBTsBtn');
          const resumeBtn = document.getElementById('resumeSyncAllCBTsBtn');
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (resumeBtn) resumeBtn.style.display = 'inline-block';
          
          const alert = document.getElementById('cbtsAlert');
          if (alert) {
            alert.innerHTML = '⏸️ <strong>Sincronización pausada.</strong> Puedes reanudarla cuando quieras.';
            alert.classList.remove('alert-info', 'alert-success', 'alert-error');
            alert.classList.add('alert-warning');
            alert.style.display = 'block';
          }
        } else {
          throw new Error(data.error?.message || 'Error al pausar sincronización');
        }
      } catch (error) {
        console.error('[PAUSE SYNC ALL] Error:', error);
        window.alert('Error al pausar sincronización: ' + (error.message || 'Error desconocido'));
      }
    }
    
    // Resume sync all
    async function resumeSyncAllCBTs() {
      try {
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/sync-all/resume\`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          }
        );
        
        const data = await response.json();
        if (data.success) {
          const pauseBtn = document.getElementById('pauseSyncAllCBTsBtn');
          const resumeBtn = document.getElementById('resumeSyncAllCBTsBtn');
          if (pauseBtn) pauseBtn.style.display = 'inline-block';
          if (resumeBtn) resumeBtn.style.display = 'none';
          
          const alert = document.getElementById('cbtsAlert');
          if (alert) {
            alert.innerHTML = '▶️ <strong>Sincronización reanudada.</strong> Continuando desde donde se quedó...';
            alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
            alert.classList.add('alert-success');
            alert.style.display = 'block';
          }
        } else {
          throw new Error(data.error?.message || 'Error al reanudar sincronización');
        }
      } catch (error) {
        console.error('[RESUME SYNC ALL] Error:', error);
        window.alert('Error al reanudar sincronización: ' + (error.message || 'Error desconocido'));
      }
    }
    
    // Stop sync all
    async function stopSyncAllCBTs() {
      if (!confirm('¿Estás seguro de que quieres DETENER completamente la sincronización? No podrás continuar desde donde se quedó.')) {
        return;
      }
      
      try {
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/sync-all/stop\`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          }
        );
        
        const data = await response.json();
        if (data.success) {
          isSyncingAll = false;
          if (syncAllInterval) {
            clearInterval(syncAllInterval);
            syncAllInterval = null;
          }
          
          const pauseBtn = document.getElementById('pauseSyncAllCBTsBtn');
          const resumeBtn = document.getElementById('resumeSyncAllCBTsBtn');
          const stopBtn = document.getElementById('stopSyncAllCBTsBtn');
          const syncAllBtn = document.getElementById('syncAllCBTsBtn');
          
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (resumeBtn) resumeBtn.style.display = 'none';
          if (stopBtn) stopBtn.style.display = 'none';
          if (syncAllBtn) {
            syncAllBtn.disabled = false;
            syncAllBtn.textContent = 'Sync All CBTs';
          }
          
          const alert = document.getElementById('cbtsAlert');
          if (alert) {
            alert.innerHTML = '🛑 <strong>Sincronización detenida.</strong> Puedes iniciar una nueva sincronización cuando quieras.';
            alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
            alert.classList.add('alert-error');
            alert.style.display = 'block';
          }
        } else {
          throw new Error(data.error?.message || 'Error al detener sincronización');
        }
      } catch (error) {
        console.error('[STOP SYNC ALL] Error:', error);
        window.alert('Error al detener sincronización: ' + (error.message || 'Error desconocido'));
      }
    }
    
    // Continue sync unsynced CBTs
    async function continueSyncCBTs() {
      const continueBtn = document.getElementById('continueSyncCBTsBtn');
      const alert = document.getElementById('cbtsAlert');

      // Confirm action
      if (!confirm('¿Continuar sincronización de CBTs sin sincronizar? Esto procesará solo los CBTs que aún no tienen datos completos.')) {
        return;
      }

      if (continueBtn) {
        continueBtn.disabled = true;
        continueBtn.textContent = 'Iniciando...';
      }

      if (alert) {
        alert.innerHTML = '<span class="spinner"></span> <strong>Iniciando sincronización de CBTs sin sincronizar...</strong>';
        alert.classList.remove('alert-success', 'alert-warning', 'alert-error');
        alert.classList.add('show', 'alert-info');
        alert.style.display = 'block';
      }

      try {
        console.log('[CONTINUE SYNC CBTS] Starting continue sync request...');
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/cbts/continue-sync\`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          }
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[CONTINUE SYNC CBTS] Response not OK:', response.status, errorText);
          throw new Error(\`Error: \${response.status} - \${errorText.substring(0, 100)}\`);
        }

        const data = await response.json();
        console.log('[CONTINUE SYNC CBTS] Response:', data);

        if (data.success) {
          if (continueBtn) {
            continueBtn.disabled = false;
            continueBtn.textContent = 'Continuar Sincronización';
          }

          if (alert) {
            alert.innerHTML = \`✅ <strong>Sincronización iniciada.</strong> Se están procesando \${data.data?.total?.toLocaleString() || 0} CBTs sin sincronizar en segundo plano.<br><small>Los datos se actualizarán automáticamente. Puedes cerrar esta página y la sincronización continuará.</small>\`;
            alert.classList.remove('alert-info', 'alert-warning', 'alert-error');
            alert.classList.add('alert-success');
            alert.style.display = 'block';
          }

          // Start polling to update progress
          let pollCount = 0;
          const maxPolls = 1000; // Poll for up to ~16 minutes (1 poll per second)
          const continueSyncInterval = setInterval(async () => {
            pollCount++;
            
            try {
              // Reload CBTs to see updated data
              const result = await loadSavedCBTs(currentPage);
              const cbts = result.cbts || [];
              
              // Count how many CBTs have been synced (have title or price)
              const syncedCount = cbts.filter(cbt => cbt.title || (cbt.price !== null && cbt.price !== undefined)).length;
              const totalCBTs = result.total || 0;
              
              // Update progress (we don't know exact unsynced count, so we show general progress)
              if (alert) {
                alert.innerHTML = \`🔄 <strong>Sincronizando CBTs sin sincronizar...</strong><br><small>Total CBTs: \${totalCBTs.toLocaleString()}. Los datos se actualizan automáticamente.</small>\`;
              }
              
              // Stop polling after max polls
              if (pollCount >= maxPolls) {
                clearInterval(continueSyncInterval);
                if (alert) {
                  alert.innerHTML = '⏱️ <strong>Monitoreo detenido.</strong> La sincronización continúa en segundo plano. Recarga la página para ver el progreso actualizado.';
                  alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
                  alert.classList.add('alert-info');
                }
              }
            } catch (error) {
              console.error('[CONTINUE SYNC CBTS] Error polling:', error);
              clearInterval(continueSyncInterval);
            }
          }, 1000); // Poll every second

          // Stop polling after 5 minutes
          setTimeout(() => {
            clearInterval(continueSyncInterval);
          }, 5 * 60 * 1000);
        } else {
          throw new Error(data.error?.message || 'Error al iniciar sincronización');
        }
      } catch (error) {
        console.error('[CONTINUE SYNC CBTS] Error:', error);
        if (continueBtn) {
          continueBtn.disabled = false;
          continueBtn.textContent = 'Continuar Sincronización';
        }
        
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (alert) {
          alert.innerHTML = \`✗ <strong>Error al iniciar sincronización:</strong> \${errorMsg}\`;
          alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
          alert.classList.add('alert-error');
          alert.style.display = 'block';
        } else {
          window.alert('Error al iniciar sincronización: ' + errorMsg);
        }
      }
    }

    // Make functions global
    window.fetchCBTs = fetchCBTs;
    window.saveCBTs = saveCBTs;
    window.pauseAutoFetch = pauseAutoFetch;
    window.syncCBTs = syncCBTs; // Keep for compatibility
    window.syncCBT = syncCBT; // Individual CBT sync
    window.syncAllCBTs = syncAllCBTs; // Sync all CBTs
    window.pauseSyncAllCBTs = pauseSyncAllCBTs; // Pause sync all
    window.resumeSyncAllCBTs = resumeSyncAllCBTs; // Resume sync all
    window.stopSyncAllCBTs = stopSyncAllCBTs; // Stop sync all
    window.goToFirstPage = goToFirstPage; // Pagination
    window.goToPreviousPage = goToPreviousPage; // Pagination
    window.goToNextPage = goToNextPage; // Pagination
    window.goToLastPage = goToLastPage; // Pagination
    window.continueSyncCBTs = continueSyncCBTs; // Continue sync unsynced CBTs
    
    console.log('[INIT] ✅ Functions exposed to window:', {
      fetchCBTs: typeof window.fetchCBTs,
      saveCBTs: typeof window.saveCBTs,
      pauseAutoFetch: typeof window.pauseAutoFetch
    });
    
    // Collapsible section
    function toggleInfoSection() {
      const section = document.getElementById('infoSection');
      const icon = document.getElementById('collapseIcon');
      const isOpen = section.style.display !== 'none';
      
      if (isOpen) {
        section.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
      } else {
        section.style.display = 'block';
        icon.style.transform = 'rotate(0deg)';
      }
    }
    
    // Initialize: section closed by default
    document.addEventListener('DOMContentLoaded', () => {
      const section = document.getElementById('infoSection');
      const icon = document.getElementById('collapseIcon');
      if (section && icon) {
      section.style.display = 'none';
      icon.style.transform = 'rotate(-90deg)';
      }
    });
    
    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
    
  </script>
  
  <!-- Error Modal -->
  <div id="errorModal" class="error-modal" onclick="if(event.target === this) closeErrorModal()">
    <div class="error-modal-content" onclick="event.stopPropagation()">
      <div class="error-modal-header">
        <h3 id="errorModalTitle" class="error-modal-title">Error de Sincronización</h3>
        <button class="error-modal-close" onclick="closeErrorModal()" title="Cerrar">×</button>
      </div>
      <div id="errorModalBody" class="error-modal-body">
        <!-- Error details will be inserted here -->
      </div>
    </div>
  </div>
  
  <!-- Performance Modal -->
  <div id="performanceModal" class="performance-modal" onclick="if(event.target === this) closePerformanceModal()">
    <div class="performance-modal-content" onclick="event.stopPropagation()">
      <div class="performance-modal-header">
        <h3 id="performanceModalTitle" class="performance-modal-title">Listings Quality</h3>
        <button class="error-modal-close" onclick="closePerformanceModal()" title="Cerrar">×</button>
      </div>
      <div id="performanceModalBody" class="error-modal-body">
        <!-- Performance details will be inserted here -->
      </div>
    </div>
  </div>
</body>
</html>
    `;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    logger.error('[GLOBAL SELLER DETAILS] Error:', error);
    console.error('[GLOBAL SELLER DETAILS] Error details:', error);
    
    if (error instanceof Error) {
      console.error('[GLOBAL SELLER DETAILS] Error message:', error.message);
      console.error('[GLOBAL SELLER DETAILS] Error stack:', error.stack);
      
      if (error.message === 'Unauthorized') {
        return Response.redirect(new URL('/auth/login', request.url).toString(), 302);
      }
      
      // Return error with more details in development
      return errorResponse(
        `Internal server error: ${error.message}`,
        500,
        'INTERNAL_ERROR'
      );
    }
    
    return errorResponse('Internal server error', 500, 'INTERNAL_ERROR');
  }
}
