import { requireAuth } from '../middlewares/auth';
import { GlobalSellerService } from '../services/global-seller.service';
import { GlobalSellerRepository } from '../repositories/global-seller.repository';
import { MercadoLibreAPIService } from '../services/mercado-libre-api.service';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { AuthService } from '../services/auth.service';
import { errorResponse } from '../utils/response';

export interface Env {
  DB: D1Database;
}

/**
 * GET /dashboard/global-seller/:id
 * View details of a Global Seller
 */
export async function globalSellerDetailsHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);
    const globalSellerRepo = new GlobalSellerRepository(env.DB);
    const mlAPIService = new MercadoLibreAPIService();
    const globalSellerService = new GlobalSellerService(globalSellerRepo, mlAPIService);

    const user = await requireAuth(request, env, authService);

    const url = new URL(request.url);
    const id = url.pathname.split('/').pop();

    if (!id) {
      return errorResponse('Global Seller ID is required', 400, 'MISSING_ID');
    }

    const globalSeller = await globalSellerService.getById(id);

    if (!globalSeller) {
      return errorResponse('Global Seller not found', 404, 'NOT_FOUND');
    }

    // Verify ownership
    if (globalSeller.user_id !== user.id) {
      return errorResponse('Access denied', 403, 'FORBIDDEN');
    }

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
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    .card-title {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 24px;
      color: var(--text-primary);
      padding-bottom: 16px;
      border-bottom: 2px solid var(--border-color);
    }
    
    .card-header-collapsible {
      cursor: pointer;
      user-select: none;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--border-color);
      margin-bottom: 24px;
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
    
    .info-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
    }
    
    .info-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    
    .info-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-secondary);
      letter-spacing: 0.5px;
    }
    
    .info-value {
      font-size: 16px;
      font-weight: 500;
      color: var(--text-primary);
    }
    
    .info-value.empty {
      color: var(--text-secondary);
      font-style: italic;
    }
    
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .badge-advanced {
      background: #d1fae5;
      color: #065f46;
    }
    
    [data-theme="dark"] .badge-advanced {
      background: #064e3b;
      color: #6ee7b7;
    }
    
    .full-width {
      grid-column: 1 / -1;
    }
    
    .highlight-box {
      background: var(--bg-secondary);
      border-left: 4px solid var(--accent);
      padding: 16px;
      border-radius: 8px;
      margin-top: 8px;
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
      <div class="info-grid">
        <!-- Nombre Completo Destacado -->
        <div class="info-item full-width">
          <span class="info-label">Nombre Completo</span>
          <div class="highlight-box">
            <span class="info-value" style="font-size: 20px; font-weight: 700;">
              ${globalSeller.name || `${globalSeller.ml_first_name || ''} ${globalSeller.ml_last_name || ''}`.trim() || globalSeller.ml_nickname || 'Sin nombre'}
            </span>
          </div>
        </div>
        
        <!-- Información Básica de Identificación -->
        <div class="info-item">
          <span class="info-label">ML User ID</span>
          <span class="info-value" style="font-family: monospace;">${globalSeller.ml_user_id}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Nickname</span>
          <span class="info-value ${!globalSeller.ml_nickname ? 'empty' : ''}">${globalSeller.ml_nickname || 'No disponible'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Email</span>
          <span class="info-value ${!globalSeller.ml_email ? 'empty' : ''}">${globalSeller.ml_email || 'No disponible'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Primer Nombre</span>
          <span class="info-value ${!globalSeller.ml_first_name ? 'empty' : ''}">${globalSeller.ml_first_name || 'No disponible'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Apellido</span>
          <span class="info-value ${!globalSeller.ml_last_name ? 'empty' : ''}">${globalSeller.ml_last_name || 'No disponible'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">País</span>
          <span class="info-value ${!globalSeller.ml_country_id ? 'empty' : ''}">${globalSeller.ml_country_id || 'No disponible'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Site ID</span>
          <span class="info-value ${!globalSeller.ml_site_id ? 'empty' : ''}">${globalSeller.ml_site_id || 'No disponible'}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Experiencia como Seller</span>
          <span class="info-value">
            ${globalSeller.ml_seller_experience 
              ? `<span class="badge badge-advanced">${globalSeller.ml_seller_experience}</span>` 
              : '<span class="empty">No disponible</span>'}
          </span>
        </div>
        <div class="info-item">
          <span class="info-label">Fecha de Registro en ML</span>
          <span class="info-value ${!globalSeller.ml_registration_date ? 'empty' : ''}">${globalSeller.ml_registration_date ? new Date(globalSeller.ml_registration_date).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'No disponible'}</span>
        </div>
        
        <!-- Información de Empresa -->
        ${globalSeller.ml_corporate_name ? `
        <div class="info-item">
          <span class="info-label">Razón Social</span>
          <span class="info-value">${globalSeller.ml_corporate_name}</span>
        </div>
        ` : ''}
        ${globalSeller.ml_brand_name ? `
        <div class="info-item">
          <span class="info-label">Marca / Brand Name</span>
          <span class="info-value">${globalSeller.ml_brand_name}</span>
        </div>
        ` : ''}
        ${globalSeller.ml_tax_id ? `
        <div class="info-item">
          <span class="info-label">Tax ID / CUIT / Identificación</span>
          <span class="info-value">${globalSeller.ml_tax_id}</span>
        </div>
        ` : ''}
        
        <!-- Información de Contacto -->
        ${globalSeller.ml_phone ? `
        <div class="info-item">
          <span class="info-label">Teléfono</span>
          <span class="info-value">${globalSeller.ml_phone}</span>
        </div>
        ` : ''}
        ${globalSeller.ml_address ? `
        <div class="info-item">
          <span class="info-label">Dirección</span>
          <span class="info-value">${globalSeller.ml_address}</span>
        </div>
        ` : ''}
        ${globalSeller.ml_city ? `
        <div class="info-item">
          <span class="info-label">Ciudad</span>
          <span class="info-value">${globalSeller.ml_city}</span>
        </div>
        ` : ''}
        ${globalSeller.ml_state ? `
        <div class="info-item">
          <span class="info-label">Estado / Provincia</span>
          <span class="info-value">${globalSeller.ml_state}</span>
        </div>
        ` : ''}
        ${globalSeller.ml_zip_code ? `
        <div class="info-item">
          <span class="info-label">Código Postal</span>
          <span class="info-value">${globalSeller.ml_zip_code}</span>
        </div>
        ` : ''}
        
        <!-- Información del Sistema (separada visualmente) -->
        <div class="info-item full-width" style="margin-top: 24px; padding-top: 24px; border-top: 2px solid var(--border-color);">
          <span class="info-label" style="font-size: 14px; margin-bottom: 16px;">Información del Sistema Orbix</span>
        </div>
        <div class="info-item">
          <span class="info-label">ID del Global Seller</span>
          <span class="info-value" style="font-family: monospace; font-size: 12px;">${globalSeller.id}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Creado en Orbix</span>
          <span class="info-value">${new Date(globalSeller.created_at * 1000).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Última Actualización</span>
          <span class="info-value">${new Date(globalSeller.updated_at * 1000).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        ${globalSeller.ml_info_updated_at ? `
        <div class="info-item">
          <span class="info-label">Información ML Actualizada</span>
          <span class="info-value">${new Date(globalSeller.ml_info_updated_at * 1000).toLocaleString('es-ES', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        ` : ''}
      </div>
      </div>
    </div>
    
    <!-- Publicaciones Section -->
    <div class="info-card">
      <h2 class="card-title">Publicaciones (Items)</h2>
      <div id="itemsSection">
        <div style="margin-bottom: 24px;">
          <div id="itemsCount" style="font-size: 18px; font-weight: 600; color: var(--text-primary);">
            Cargando...
          </div>
        </div>
        
        <div id="paginationLimitInfo" class="alert alert-warning" style="display: none; margin-bottom: 16px;">
          <strong>💡 Límite de paginación alcanzado</strong><br>
          Mercado Libre limita la paginación a ~1,000 items por consulta. Para acceder a más items:
          <ul style="margin: 8px 0 0 20px; padding: 0;">
            <li>Cambia el <strong>Filtro de Estado</strong> a "Pausadas" o "Cerradas" para sincronizar esos items</li>
            <li>Cambia el <strong>Orden</strong> a "Más antiguas" para acceder a items más antiguos</li>
            <li>Usa diferentes combinaciones de filtros para cubrir todos tus items</li>
          </ul>
        </div>
        
        <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 24px; flex-wrap: wrap;">
          <label style="font-weight: 500;">Filtro de Estado:</label>
          <select id="statusFilter" class="form-input" style="width: auto; min-width: 150px;">
            <option value="active" selected>Activas</option>
            <option value="paused">Pausadas</option>
            <option value="closed">Cerradas</option>
          </select>
          <label style="font-weight: 500;">Orden:</label>
          <select id="orderFilter" class="form-input" style="width: auto; min-width: 180px;">
            <option value="start_time_desc">Más recientes</option>
            <option value="start_time_asc">Más antiguas</option>
            <option value="price_desc">Mayor precio</option>
            <option value="price_asc">Menor precio</option>
          </select>
          <button class="btn btn-primary" onclick="syncAllItems()" id="syncAllBtn">
            Sincronizar Todo
          </button>
          <button class="btn btn-secondary" onclick="continueSync()" id="continueBtn" style="display: none;">
            Continuar
          </button>
          <button class="btn btn-danger" onclick="stopSync()" id="stopBtn" style="display: none;">
            Detener
          </button>
        </div>
        
        <div id="itemsAlert" class="alert">
          <div id="progressContainer" class="progress-container" style="display: none;">
            <div class="progress-bar">
              <div id="progressFill" class="progress-fill" style="width: 0%;"></div>
            </div>
          </div>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <label style="font-weight: 500; font-size: 14px;">Filtrar tabla por estado:</label>
            <select id="tableStatusFilter" class="form-input" style="width: auto; min-width: 150px;" onchange="filterTableByStatus()">
              <option value="all" selected>Todos</option>
              <option value="active">Activas</option>
              <option value="paused">Pausadas</option>
              <option value="closed">Cerradas</option>
            </select>
            
            <label style="font-weight: 500; font-size: 14px;">Ordenar por precio:</label>
            <select id="priceOrderFilter" class="form-input" style="width: auto; min-width: 150px;" onchange="filterTableByStatus()">
              <option value="none" selected>Sin orden</option>
              <option value="asc">Menor a Mayor</option>
              <option value="desc">Mayor a Menor</option>
            </select>
          </div>
          <div id="tableItemsCount" style="color: var(--text-secondary); font-size: 14px;">
            Mostrando 0 items
          </div>
        </div>
        
        <div id="itemsTableContainer">
          <div class="table-container">
            <table id="itemsTable">
              <thead>
                <tr>
                  <th>Imagen</th>
                  <th>CBT</th>
                  <th>Título</th>
                  <th class="sortable" data-sort="price" onclick="sortTable('price')">
                    Precio<span class="sort-icon"></span>
                  </th>
                  <th class="sortable" data-sort="available_quantity" onclick="sortTable('available_quantity')">
                    Disponible<span class="sort-icon"></span>
                  </th>
                  <th class="sortable" data-sort="sold_quantity" onclick="sortTable('sold_quantity')">
                    Vendidos<span class="sort-icon"></span>
                  </th>
                  <th class="sortable" data-sort="status" onclick="sortTable('status')">
                    Estado<span class="sort-icon"></span>
                  </th>
                  <th class="sortable" data-sort="start_time" onclick="sortTable('start_time')">
                    Fecha<span class="sort-icon"></span>
                  </th>
                </tr>
              </thead>
              <tbody id="itemsTableBody">
              </tbody>
            </table>
          </div>
          
          <div id="itemsPagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 24px; flex-wrap: wrap; gap: 16px;">
            <div id="itemsPaginationInfo" style="color: var(--text-secondary); font-size: 14px;"></div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" onclick="previousPage()" id="prevPageBtn" disabled>Anterior</button>
              <button class="btn btn-secondary" onclick="nextPage()" id="nextPageBtn" disabled>Siguiente</button>
            </div>
          </div>
        </div>
      </div>
    </div>
      </div>
    </main>
  </div>
  
  <script>
    const globalSellerId = '${globalSeller.id}';
    let currentPage = 0;
    const itemsPerPage = 50;
    let totalItems = 0;
    const maxOffset = 10000; // Límite de ML API
    
    // Load items count on page load
    async function loadItemsCount() {
      const countElement = document.getElementById('itemsCount');
      countElement.textContent = 'Cargando...';
      
      try {
        const response = await fetch(\`/api/global-sellers/\${globalSellerId}/items/count\`, {
          credentials: 'include'
        });
        
        if (!response.ok) {
          console.error('Response not OK:', response.status, response.statusText);
          countElement.textContent = \`Error: \${response.status} - \${response.statusText}\`;
          return;
        }
        
        const data = await response.json();
        console.log('Items count response:', data);
        
        if (data.success && data.data && data.data.count) {
          const count = data.data.count;
          const source = data.data.source || 'ml_api';
          const sourceBadge = source === 'database' 
            ? '<span style="font-size: 10px; color: var(--text-secondary); margin-left: 8px;">(BD)</span>'
            : '<span style="font-size: 10px; color: var(--text-secondary); margin-left: 8px;">(ML)</span>';
          
          countElement.innerHTML = \`
            <span style="color: var(--accent); font-weight: 600;">\${(count.active || 0).toLocaleString()}</span> activas | 
            <span style="color: #f59e0b; font-weight: 600;">\${(count.paused || 0).toLocaleString()}</span> pausadas | 
            <span style="color: var(--text-secondary); font-weight: 600;">\${(count.closed || 0).toLocaleString()}</span> cerradas | 
            <strong style="font-size: 20px;">\${(count.total || 0).toLocaleString()}</strong> total \${sourceBadge}
          \`;
        } else {
          console.error('Unexpected response format:', data);
          countElement.textContent = \`Error: \${data.error?.message || 'Formato de respuesta inesperado'}\`;
        }
      } catch (error) {
        console.error('Error loading items count:', error);
        countElement.textContent = \`Error de conexión: \${error.message || 'Desconocido'}\`;
      }
    }
    
    let isLoading = false;
    let shouldStop = false; // Flag to stop synchronization
    let allLoadedItems = []; // Store all loaded items
    let syncStartTime = null; // Track when sync started
    let lastSyncUpdate = null; // Track last update time
    let sortColumn = null; // Current sort column
    let sortDirection = 'asc'; // Current sort direction: 'asc' or 'desc'
    
    function updatePagination() {
      const info = document.getElementById('itemsPaginationInfo');
      const prevBtn = document.getElementById('prevPageBtn');
      const nextBtn = document.getElementById('nextPageBtn');
      
      // Show info about loaded items
      let paginationText = \`Mostrando \${allLoadedItems.length.toLocaleString()} items cargados\`;
      if (totalItems > 0) {
        paginationText += \` de \${totalItems.toLocaleString()} totales\`;
      }
      if (totalItems > maxOffset) {
        paginationText += \` (Límite de ML: \${maxOffset.toLocaleString()} items accesibles)\`;
      }
      
      info.innerHTML = paginationText;
      
      // Disable pagination buttons (we load everything at once)
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    }
    
    function previousPage() {
      // Not used - we load all items at once
    }
    
    function nextPage() {
      // Not used - we load all items at once
    }
    
    // Load saved items from database on page load
    async function loadSavedItems() {
      // Load ALL items regardless of status filter (we'll filter in the table)
      const tableContainer = document.getElementById('itemsTableContainer');
      const tableBody = document.getElementById('itemsTableBody');
      const continueBtn = document.getElementById('continueBtn');
      
      try {
        // Load all items without status filter, with a high limit to get all items
        // IMPORTANT: Do NOT pass status parameter to get ALL items
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/items/saved?limit=50000&offset=0&orderBy=synced_at&orderDir=DESC\`,
          { credentials: 'include' }
        );
        
        console.log('[LOAD] Request URL:', response.url || 'N/A');
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data.items) {
            const items = data.data.items || [];
            console.log('[LOAD] Loaded items from DB:', items.length);
            console.log('[LOAD] Status distribution:', {
              active: items.filter(i => i.status === 'active').length,
              paused: items.filter(i => i.status === 'paused').length,
              closed: items.filter(i => i.status === 'closed').length,
              other: items.filter(i => i.status && !['active', 'paused', 'closed'].includes(i.status)).length,
              noStatus: items.filter(i => !i.status).length
            });
            
            allLoadedItems = items;
            totalItems = data.data.paging?.total || items.length;
            
            tableContainer.style.display = 'block';
            
            // Apply current filter and sort
            console.log('[LOAD] Applying initial filter');
            filterTableByStatus();
            
            // Show continue button if there are items
            if (continueBtn && items.length > 0) {
              continueBtn.style.display = 'inline-block';
            }
            
            updatePagination();
          } else if (data.success) {
            // No items in database
            allLoadedItems = [];
            tableContainer.style.display = 'block';
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 24px; color: var(--text-secondary);">No hay items guardados en la base de datos</td></tr>';
            const countElement = document.getElementById('tableItemsCount');
            if (countElement) countElement.textContent = 'No hay items cargados';
          }
        }
      } catch (error) {
        console.error('Error loading saved items:', error);
        allLoadedItems = [];
        const countElement = document.getElementById('tableItemsCount');
        if (countElement) countElement.textContent = 'Error al cargar items';
      }
    }
    
    // Sync all items from page 0
    async function syncAllItems() {
      await loadItemsFromPage(0);
    }
    
    // Continue from last page
    async function continueSync() {
      try {
        const response = await fetch(
          \`/api/global-sellers/\${globalSellerId}/items/sync-status\`,
          { credentials: 'include' }
        );
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data.lastPage !== undefined) {
            const lastPage = data.data.lastPage || 0;
            const nextPage = lastPage + 1; // Start from next page
            await loadItemsFromPage(nextPage);
          } else {
            // If no last page info, start from page 0
            await loadItemsFromPage(0);
          }
        }
      } catch (error) {
        console.error('Error getting sync status:', error);
        await loadItemsFromPage(0);
      }
    }
    
    // Stop synchronization
    function stopSync() {
      shouldStop = true;
      const stopBtn = document.getElementById('stopBtn');
      const alert = document.getElementById('itemsAlert');
      if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.textContent = 'Deteniendo...';
      }
      if (alert) {
        alert.textContent = 'Deteniendo sincronización...';
        alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
        alert.classList.add('alert-warning');
      }
    }
    
    // Load items from a specific page onwards
    async function loadItemsFromPage(startPage) {
      if (isLoading) {
        return;
      }
      
      const status = document.getElementById('statusFilter').value;
      const order = document.getElementById('orderFilter').value;
      const syncAllBtn = document.getElementById('syncAllBtn');
      const continueBtn = document.getElementById('continueBtn');
      const stopBtn = document.getElementById('stopBtn');
      const alert = document.getElementById('itemsAlert');
      const tableContainer = document.getElementById('itemsTableContainer');
      const tableBody = document.getElementById('itemsTableBody');
      
      isLoading = true;
      shouldStop = false; // Reset stop flag
      if (syncAllBtn) syncAllBtn.disabled = true;
      if (continueBtn) continueBtn.disabled = true;
      if (stopBtn) stopBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.disabled = false;
      if (syncAllBtn) syncAllBtn.textContent = 'Sincronizando...';
      if (continueBtn) continueBtn.textContent = 'Continuando...';
      alert.textContent = startPage === 0 ? 'Sincronizando desde el inicio...' : \`Continuando desde página \${startPage + 1}...\`;
      alert.classList.add('show', 'alert-info');
      tableContainer.style.display = 'block';
      
      try {
        let page = startPage;
        let hasMore = true;
        const maxPages = 200;
        let totalSaved = 0;
        const startTime = Date.now();
        let lastUpdateTime = startTime;
        let itemsLoadedAtStart = allLoadedItems.length;
        const progressContainer = document.getElementById('progressContainer');
        const progressFill = document.getElementById('progressFill');
        
        // Show progress bar
        if (progressContainer) progressContainer.style.display = 'block';
        
        while (hasMore && page < maxPages && !shouldStop) {
          const offset = page * 50;
          
          if (offset >= maxOffset) {
            alert.textContent = \`Límite de paginación alcanzado (10,000 items). Total cargado: \${allLoadedItems.length} items.\`;
            alert.classList.remove('alert-info');
            alert.classList.add('alert-warning');
            if (progressContainer) progressContainer.style.display = 'none';
            break;
          }
          
          // Calculate progress and estimated time
          const currentTime = Date.now();
          const elapsedSeconds = (currentTime - startTime) / 1000;
          const itemsLoaded = allLoadedItems.length - itemsLoadedAtStart;
          const itemsPerSecond = itemsLoaded > 0 && elapsedSeconds > 0 ? itemsLoaded / elapsedSeconds : 0;
          
          // Calculate estimated time remaining
          let estimatedTimeRemaining = '';
          if (totalItems > 0 && itemsPerSecond > 0) {
            const remainingItems = Math.min(totalItems - allLoadedItems.length, maxOffset - allLoadedItems.length);
            const secondsRemaining = Math.ceil(remainingItems / itemsPerSecond);
            
            if (secondsRemaining > 0) {
              const minutes = Math.floor(secondsRemaining / 60);
              const seconds = secondsRemaining % 60;
              if (minutes > 0) {
                estimatedTimeRemaining = \` - Tiempo estimado: \${minutes}m \${seconds}s\`;
              } else {
                estimatedTimeRemaining = \` - Tiempo estimado: \${seconds}s\`;
              }
            }
          }
          
          // Calculate progress percentage
          const progressPercent = totalItems > 0 
            ? Math.min((allLoadedItems.length / Math.min(totalItems, maxOffset)) * 100, 100)
            : 0;
          
          // Update progress bar
          if (progressFill) {
            progressFill.style.width = \`\${progressPercent}%\`;
          }
          
          // Update alert with spinner and friendly message
          const spinner = '<span class="spinner"></span>';
          const progressText = totalItems > 0 
            ? \`\${Math.round(progressPercent)}% completado\`
            : '';
          alert.innerHTML = \`
            \${spinner}
            <strong>Cargando página \${page + 1}</strong> | 
            <strong>\${allLoadedItems.length.toLocaleString()}</strong> de \${totalItems > 0 ? totalItems.toLocaleString() : '?'} items cargados
            \${progressText ? ' | ' + progressText : ''}
            \${estimatedTimeRemaining}
          \`;
          
          // Retry logic for temporary errors (503, 429, network errors)
          let response;
          let data;
          let retries = 3;
          let lastError;
          
          for (let attempt = 0; attempt < retries; attempt++) {
            try {
              response = await fetch(
                \`/api/global-sellers/\${globalSellerId}/items/load\`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status, order, page }),
                  credentials: 'include'
                }
              );
              
              if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                
                // If 503, wait and retry
                if (response.status === 503 && attempt < retries - 1) {
                  const waitTime = Math.min(5 * (attempt + 1), 15); // Max 15 seconds
                  console.log(\`[LOAD] Service unavailable (503), waiting \${waitTime}s before retry (attempt \${attempt + 1}/\${retries})...\`);
                  alert.innerHTML = \`
                    <span class="spinner"></span>
                    <strong>Servicio temporalmente no disponible</strong> | 
                    Reintentando en \${waitTime}s... (intento \${attempt + 1}/\${retries})
                  \`;
                  await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
                  continue;
                }
                
                // For other errors or last attempt, throw
                throw new Error(errorData.error?.message || \`Error \${response.status}: \${response.statusText}\`);
              }
              
              data = await response.json();
              break; // Success, exit retry loop
              
            } catch (fetchError) {
              lastError = fetchError;
              if (attempt < retries - 1) {
                const waitTime = Math.min(2 * (attempt + 1), 10); // Max 10 seconds
                console.log(\`[LOAD] Network error, waiting \${waitTime}s before retry (attempt \${attempt + 1}/\${retries})...\`);
                alert.innerHTML = \`
                  <span class="spinner"></span>
                  <strong>Error de conexión</strong> | 
                  Reintentando en \${waitTime}s... (intento \${attempt + 1}/\${retries})
                \`;
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
              } else {
                throw fetchError; // Last attempt failed, throw error
              }
            }
          }
          
          if (data.success) {
            const items = data.data.items || [];
            totalItems = data.data.paging?.total || 0;
            const saved = data.data.saved || 0;
            hasMore = data.data.hasMore || false;
            
            totalSaved += saved;
            
            // Add new items (avoid duplicates)
            const existingIds = new Set(allLoadedItems.map(item => item.id));
            const newItems = items.filter(item => !existingIds.has(item.id));
            allLoadedItems.push(...newItems);
            
            // Update table - apply filter and sort
            if (allLoadedItems.length > 0) {
              filterTableByStatus();
            } else {
              const tableBody = document.getElementById('itemsTableBody');
              if (tableBody) tableBody.innerHTML = '';
              const countElement = document.getElementById('tableItemsCount');
              if (countElement) countElement.textContent = 'No hay items cargados';
            }
            
            // Update progress message after loading page
            const currentTimeAfter = Date.now();
            const elapsedSecondsAfter = (currentTimeAfter - startTime) / 1000;
            const itemsLoadedAfter = allLoadedItems.length - itemsLoadedAtStart;
            const itemsPerSecondAfter = itemsLoadedAfter > 0 && elapsedSecondsAfter > 0 ? itemsLoadedAfter / elapsedSecondsAfter : 0;
            
            let estimatedTimeRemainingAfter = '';
            if (totalItems > 0 && itemsPerSecondAfter > 0) {
              const remainingItemsAfter = Math.min(totalItems - allLoadedItems.length, maxOffset - allLoadedItems.length);
              const secondsRemainingAfter = Math.ceil(remainingItemsAfter / itemsPerSecondAfter);
              
              if (secondsRemainingAfter > 0) {
                const minutesAfter = Math.floor(secondsRemainingAfter / 60);
                const secondsAfter = secondsRemainingAfter % 60;
                if (minutesAfter > 0) {
                  estimatedTimeRemainingAfter = \` - Tiempo estimado: \${minutesAfter}m \${secondsAfter}s\`;
                } else {
                  estimatedTimeRemainingAfter = \` - Tiempo estimado: \${secondsAfter}s\`;
                }
              }
            }
            
            const progressPercentAfter = totalItems > 0 
              ? Math.min((allLoadedItems.length / Math.min(totalItems, maxOffset)) * 100, 100)
              : 0;
            
            if (progressFill) {
              progressFill.style.width = \`\${progressPercentAfter}%\`;
            }
            
            const spinnerAfter = '<span class="spinner"></span>';
            const progressTextAfter = totalItems > 0 
              ? \`\${Math.round(progressPercentAfter)}% completado\`
              : '';
            alert.innerHTML = \`
              \${spinnerAfter}
              <strong>Página \${page + 1} cargada</strong> | 
              <strong>\${allLoadedItems.length.toLocaleString()}</strong> de \${totalItems > 0 ? totalItems.toLocaleString() : '?'} items
              \${progressTextAfter ? ' | ' + progressTextAfter : ''}
              \${estimatedTimeRemainingAfter}
            \`;
            
            // Check if pagination limit was reached
            const paginationLimitReached = data.data.paginationLimitReached || false;
            
            if (!hasMore || items.length === 0 || paginationLimitReached) {
              if (progressContainer) progressContainer.style.display = 'none';
              if (progressFill) progressFill.style.width = '100%';
              
              if (paginationLimitReached) {
                // Show info about how to access more items
                const paginationInfo = document.getElementById('paginationLimitInfo');
                if (paginationInfo) paginationInfo.style.display = 'block';
                
                alert.innerHTML = \`⚠️ Límite de paginación alcanzado. Mercado Libre no permite cargar más items desde la API (offset máximo: \${offset}). Total cargado: <strong>\${allLoadedItems.length.toLocaleString()}</strong> items, <strong>\${totalSaved.toLocaleString()}</strong> nuevos guardados.<br><small>💡 Cambia el filtro de estado u orden para acceder a más items.</small>\`;
                alert.classList.remove('alert-info', 'alert-success');
                alert.classList.add('alert-warning');
              } else {
                // Hide pagination info if sync completed normally
                const paginationInfo = document.getElementById('paginationLimitInfo');
                if (paginationInfo) paginationInfo.style.display = 'none';
                
                alert.innerHTML = \`✓ Carga completada. Total: <strong>\${allLoadedItems.length.toLocaleString()}</strong> items, <strong>\${totalSaved.toLocaleString()}</strong> nuevos guardados.\`;
                alert.classList.remove('alert-info', 'alert-warning');
                alert.classList.add('alert-success');
              }
              break;
            }
            
            // Check if stop was requested after processing this page
            if (shouldStop) {
              if (progressContainer) progressContainer.style.display = 'none';
              alert.innerHTML = \`⏸ Sincronización detenida. Total cargado: <strong>\${allLoadedItems.length.toLocaleString()}</strong> items, <strong>\${totalSaved.toLocaleString()}</strong> nuevos guardados.\`;
              alert.classList.remove('alert-info', 'alert-success');
              alert.classList.add('alert-warning');
              break;
            }
            
            page++;
            await new Promise(resolve => setTimeout(resolve, 500));
          } else {
            throw new Error(data.error?.message || 'Error al cargar items');
          }
        }
        
        updatePagination();
      } catch (error) {
        console.error('Error loading items:', error);
        if (progressContainer) progressContainer.style.display = 'none';
        
        // Provide user-friendly error messages
        let errorMessage = error.message || 'Error de conexión';
        if (errorMessage.includes('503') || errorMessage.includes('Service Unavailable')) {
          errorMessage = 'Mercado Libre está temporalmente no disponible. Por favor, intenta de nuevo en unos momentos.';
        } else if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
          errorMessage = 'Límite de solicitudes alcanzado. Espera unos momentos e intenta de nuevo.';
        } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
          errorMessage = 'Token de acceso inválido. Por favor, verifica tus credenciales de Mercado Libre.';
        }
        
        alert.innerHTML = \`✗ <strong>Error:</strong> \${errorMessage}\`;
        alert.classList.remove('alert-info', 'alert-success', 'alert-warning');
        alert.classList.add('alert-error');
      } finally {
        isLoading = false;
        shouldStop = false; // Reset stop flag
        if (syncAllBtn) {
          syncAllBtn.disabled = false;
          syncAllBtn.textContent = 'Sincronizar Todo';
        }
        if (continueBtn) {
          continueBtn.disabled = false;
          continueBtn.textContent = 'Continuar';
        }
        if (stopBtn) {
          stopBtn.style.display = 'none';
          stopBtn.disabled = false;
          stopBtn.textContent = 'Detener';
        }
      }
    }
    
    // Load count and saved items on page load
    loadItemsCount();
    setTimeout(() => {
      loadSavedItems();
    }, 500);
    
    // Sort table function
    function sortTable(column) {
      const tableBody = document.getElementById('itemsTableBody');
      if (!tableBody || allLoadedItems.length === 0) return;
      
      // If sorting by price column, clear price order filter
      if (column === 'price') {
        const priceOrderSelect = document.getElementById('priceOrderFilter');
        if (priceOrderSelect) {
          priceOrderSelect.value = 'none';
        }
      }
      
      // Toggle direction if same column
      if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = column;
        sortDirection = 'asc';
      }
      
      // Update sort indicators
      document.querySelectorAll('th.sortable').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sort === column) {
          th.classList.add(\`sorted-\${sortDirection}\`);
        }
      });
      
      // Apply current filter and sort
      filterTableByStatus();
    }
    
    // Sort items array
    function sortItems(items, column, direction) {
      const sorted = [...items];
      
      sorted.sort((a, b) => {
        let aVal, bVal;
        
        switch (column) {
          case 'price':
            aVal = a.price || 0;
            bVal = b.price || 0;
            break;
          case 'available_quantity':
            aVal = a.available_quantity || 0;
            bVal = b.available_quantity || 0;
            break;
          case 'sold_quantity':
            aVal = a.sold_quantity || 0;
            bVal = b.sold_quantity || 0;
            break;
          case 'status':
            aVal = a.status || '';
            bVal = b.status || '';
            break;
          case 'start_time':
            aVal = a.start_time ? new Date(a.start_time).getTime() : 0;
            bVal = b.start_time ? new Date(b.start_time).getTime() : 0;
            break;
          default:
            return 0;
        }
        
        if (typeof aVal === 'string') {
          return direction === 'asc' 
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        } else {
          return direction === 'asc' 
            ? aVal - bVal
            : bVal - aVal;
        }
      });
      
      return sorted;
    }
    
    // Filter table by status and price
    function filterTableByStatus() {
      const statusFilter = document.getElementById('tableStatusFilter')?.value || 'all';
      const priceOrder = document.getElementById('priceOrderFilter')?.value || 'none';
      
      let filteredItems = allLoadedItems;
      
      // Apply status filter
      if (statusFilter !== 'all') {
        filteredItems = filteredItems.filter(item => {
          if (!item || item.status === null || item.status === undefined) {
            return false;
          }
          const itemStatus = String(item.status).toLowerCase();
          const filterStatus = String(statusFilter).toLowerCase();
          return itemStatus === filterStatus;
        });
      }
      
      // Apply price order if set
      if (priceOrder !== 'none') {
        // Clear column sort when using price order
        sortColumn = null;
        document.querySelectorAll('th.sortable').forEach(th => {
          th.classList.remove('sorted-asc', 'sorted-desc');
        });
        filteredItems = sortItems(filteredItems, 'price', priceOrder);
      } else if (sortColumn) {
        // Apply current column sort if no price order
        filteredItems = sortItems(filteredItems, sortColumn, sortDirection);
      }
      
      // Update count
      const countElement = document.getElementById('tableItemsCount');
      if (countElement) {
        const total = allLoadedItems.length;
        const filtered = filteredItems.length;
        if (statusFilter === 'all' && priceOrder === 'none') {
          countElement.textContent = \`Mostrando \${filtered.toLocaleString()} items\`;
        } else {
          countElement.textContent = \`Mostrando \${filtered.toLocaleString()} de \${total.toLocaleString()} items\`;
        }
      }
      
      // Render filtered items
      renderTableWithItems(filteredItems);
    }
    
    // Render table with specific items array
    function renderTableWithItems(items) {
      const tableBody = document.getElementById('itemsTableBody');
      if (!tableBody) return;
      
      tableBody.innerHTML = items.map(item => \`
        <tr>
          <td>
            <img src="\${item.thumbnail || '/favicon.svg'}" alt="\${item.title}" 
                 style="width: 60px; height: 60px; object-fit: cover; border-radius: 4px;" 
                 onerror="this.src='/favicon.svg'">
          </td>
          <td>
            <code style="background: var(--bg-tertiary); padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace;">
              \${item.id || 'N/A'}
            </code>
          </td>
          <td>
            <a href="\${item.permalink || '#'}" target="_blank" style="color: var(--accent); text-decoration: none;">
              \${item.title || 'Sin título'}
            </a>
          </td>
          <td>\${item.currency_id || ''} \${item.price?.toFixed(2) || '0.00'}</td>
          <td>\${item.available_quantity || 0}</td>
          <td>\${item.sold_quantity || 0}</td>
          <td>
            <span class="badge" style="background: \${item.status === 'active' ? '#d1fae5' : item.status === 'paused' ? '#fef3c7' : '#fee2e2'}; 
                                          color: \${item.status === 'active' ? '#065f46' : item.status === 'paused' ? '#92400e' : '#991b1b'};">
              \${item.status === 'active' ? 'Activa' : item.status === 'paused' ? 'Pausada' : 'Cerrada'}
            </span>
          </td>
          <td>\${item.start_time ? new Date(item.start_time).toLocaleDateString('es-ES') : '-'}</td>
        </tr>
      \`).join('');
    }
    
    // Make functions global
    window.syncAllItems = syncAllItems;
    window.continueSync = continueSync;
    window.stopSync = stopSync;
    window.previousPage = previousPage;
    window.nextPage = nextPage;
    window.sortTable = sortTable;
    window.filterTableByStatus = filterTableByStatus;
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
    
    // Initialize: section open by default
    document.addEventListener('DOMContentLoaded', () => {
      const section = document.getElementById('infoSection');
      const icon = document.getElementById('collapseIcon');
      section.style.display = 'block';
      icon.style.transform = 'rotate(0deg)';
    });
    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  </script>
</body>
</html>
    `;

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return Response.redirect(new URL('/auth/login', request.url), 302);
    }
    return errorResponse('Internal server error', 500);
  }
}

