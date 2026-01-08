import { requireAuth } from '../middlewares/auth';
import { AuthService } from '../services/auth.service';
import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { errorResponse } from '../utils/response';

export interface Env {
  DB: D1Database;
}

/**
 * GET /dashboard
 * Dashboard layout with navigation
 */
export async function dashboardHandler(request: Request, env: Env): Promise<Response> {
  try {
    const userRepo = new UserRepository(env.DB);
    const sessionRepo = new SessionRepository(env.DB);
    const authService = new AuthService(userRepo, sessionRepo);

    const user = await requireAuth(request, env, authService);

    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orbix - Dashboard</title>
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
    
    .content-section {
      display: none;
      animation: fadeIn 0.3s;
    }
    
    .content-section.active {
      display: block;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .card {
      background: var(--bg-primary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }
    
    .card-title {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 16px;
      color: var(--text-primary);
    }
    
    .form-group {
      margin-bottom: 20px;
    }
    
    .form-label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 8px;
      color: var(--text-primary);
    }
    
    .form-input {
      width: 100%;
      padding: 12px;
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
    
    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    
    .btn-primary {
      background: var(--accent);
      color: white;
    }
    
    .btn-primary:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    }
    
    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    .btn-secondary {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
    }
    
    .btn-secondary:hover {
      background: var(--border-color);
    }
    
    .toggle-switch {
      position: relative;
      display: inline-block;
      width: 52px;
      height: 28px;
    }
    
    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    
    .toggle-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: 0.3s;
      border-radius: 28px;
    }
    
    .toggle-slider:before {
      position: absolute;
      content: "";
      height: 20px;
      width: 20px;
      left: 4px;
      bottom: 4px;
      background-color: white;
      transition: 0.3s;
      border-radius: 50%;
    }
    
    input:checked + .toggle-slider {
      background-color: var(--accent);
    }
    
    input:checked + .toggle-slider:before {
      transform: translateX(24px);
    }
    
    .alert {
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      display: none;
    }
    
    .alert.show {
      display: block;
      animation: slideDown 0.3s;
    }
    
    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
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
    
    [data-theme="dark"] .alert-success {
      background: #064e3b;
      color: #6ee7b7;
      border-color: #10b981;
    }
    
    [data-theme="dark"] .alert-error {
      background: #7f1d1d;
      color: #fca5a5;
      border-color: #ef4444;
    }
    
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-secondary);
    }
    
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }
    
    .empty-state-text {
      font-size: 16px;
    }
    
    /* Modal */
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .modal.show {
      display: flex;
    }
    
    .modal-content {
      background: var(--bg-primary);
      border-radius: 12px;
      padding: 32px;
      max-width: 500px;
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      position: relative;
    }
    
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    
    .modal-title {
      font-size: 24px;
      font-weight: 700;
      color: var(--text-primary);
    }
    
    .modal-close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: var(--text-secondary);
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background-color 0.2s;
    }
    
    .modal-close:hover {
      background: var(--bg-tertiary);
    }
    
    /* Table */
    .table-container {
      overflow-x: auto;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    thead {
      background: var(--bg-tertiary);
    }
    
    th {
      padding: 12px;
      text-align: left;
      font-weight: 600;
      font-size: 14px;
      color: var(--text-primary);
      border-bottom: 2px solid var(--border-color);
    }
    
    td {
      padding: 12px;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-primary);
      font-size: 14px;
    }
    
    tr:hover {
      background: var(--bg-secondary);
    }
    
    .table-actions {
      display: flex;
      gap: 8px;
    }
    
    .btn-icon {
      padding: 6px 12px;
      font-size: 12px;
    }
    
    .btn-danger {
      background: #ef4444;
      color: white;
    }
    
    .btn-danger:hover {
      background: #dc2626;
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
            <a class="nav-link active" data-section="dashboard">
              <svg class="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/>
              </svg>
              Dashboard
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" data-section="settings">
              <svg class="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              Configuración
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" data-section="mercado-libre">
              <svg class="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
              </svg>
              Mercado Libre
            </a>
          </li>
          <li class="nav-item">
            <a class="nav-link" data-section="user">
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
        <h1 class="page-title" id="pageTitle">Dashboard</h1>
      </div>
      
      <!-- Dashboard Section -->
      <div class="content-section active" id="dashboard-section">
        <div class="card">
          <div class="empty-state">
            <div class="empty-state-icon">📊</div>
            <div class="empty-state-text">El dashboard estará disponible próximamente</div>
          </div>
        </div>
      </div>
      
      <!-- Settings Section -->
      <div class="content-section" id="settings-section">
        <div class="card">
          <h2 class="card-title">Apariencia</h2>
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; justify-content: space-between;">
              <span>Modo Oscuro</span>
              <label class="toggle-switch">
                <input type="checkbox" id="darkModeToggle">
                <span class="toggle-slider"></span>
              </label>
            </label>
          </div>
        </div>
      </div>
      
      <!-- Mercado Libre Section -->
      <div class="content-section" id="mercado-libre-section">
        <div class="card">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
            <h2 class="card-title" style="margin: 0;">Global Sellers</h2>
            <button class="btn btn-primary" id="addGlobalSellerBtn">
              + Agregar Global Seller
            </button>
          </div>
          
          <div id="mlAlert" class="alert"></div>
          
          <div class="table-container">
            <table id="globalSellersTable">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>ML User ID</th>
                  <th>Creado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="globalSellersTableBody">
                <tr>
                  <td colspan="4" style="text-align: center; padding: 32px; color: var(--text-secondary);">
                    Cargando...
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <!-- Modal for Global Seller Form -->
      <div class="modal" id="globalSellerModal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 class="modal-title" id="modalTitle">Agregar Global Seller</h2>
            <button class="modal-close" id="closeModal">&times;</button>
          </div>
          <div id="modalAlert" class="alert"></div>
          <form id="globalSellerForm">
            <input type="hidden" id="globalSellerId" value="">
            <div class="form-group">
              <label class="form-label">Nombre (Opcional)</label>
              <input type="text" class="form-input" id="globalSellerName" name="name" placeholder="Ej: Tienda Principal">
              <small style="color: var(--text-secondary); font-size: 12px; margin-top: 4px; display: block;">
                Un nombre descriptivo para identificar este Global Seller
              </small>
            </div>
            <div class="form-group">
              <label class="form-label">User ID</label>
              <input type="text" class="form-input" id="globalSellerMLUserId" name="mlUserId" required placeholder="Ej: 123456789">
              <small style="color: var(--text-secondary); font-size: 12px; margin-top: 4px; display: block;">
                Tu ID de usuario de Mercado Libre
              </small>
            </div>
            <div class="form-group">
              <label class="form-label">Access Token</label>
              <input type="text" class="form-input" id="globalSellerMLAccessToken" name="mlAccessToken" required placeholder="APP_USR-...">
              <small style="color: var(--text-secondary); font-size: 12px; margin-top: 4px; display: block;">
                Token de acceso de Mercado Libre
              </small>
            </div>
            <div style="display: flex; gap: 12px; justify-content: flex-end;">
              <button type="button" class="btn btn-secondary" id="cancelModalBtn">Cancelar</button>
              <button type="submit" class="btn btn-primary" id="submitGlobalSellerBtn">
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
      
      <!-- User Section -->
      <div class="content-section" id="user-section">
        <div class="card">
          <h2 class="card-title">Información del Usuario</h2>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" value="${user.email}" disabled>
            <small style="color: var(--text-secondary); font-size: 12px; margin-top: 4px; display: block;">
              El email no se puede modificar
            </small>
          </div>
          <div class="form-group">
            <label class="form-label">Rol</label>
            <input type="text" class="form-input" value="${user.role}" disabled>
          </div>
        </div>
        
        <div class="card">
          <h2 class="card-title">Cambiar Contraseña</h2>
          <div id="passwordAlert" class="alert"></div>
          <form id="changePasswordForm">
            <div class="form-group">
              <label class="form-label">Contraseña Actual</label>
              <input type="password" class="form-input" id="currentPassword" name="currentPassword" required>
            </div>
            <div class="form-group">
              <label class="form-label">Nueva Contraseña</label>
              <input type="password" class="form-input" id="newPassword" name="newPassword" required minlength="8">
              <small style="color: var(--text-secondary); font-size: 12px; margin-top: 4px; display: block;">
                Mínimo 8 caracteres con letras y números
              </small>
            </div>
            <div class="form-group">
              <label class="form-label">Confirmar Nueva Contraseña</label>
              <input type="password" class="form-input" id="confirmPassword" name="confirmPassword" required minlength="8">
            </div>
            <button type="submit" class="btn btn-primary" id="changePasswordBtn">
              Cambiar Contraseña
            </button>
          </form>
        </div>
      </div>
    </main>
  </div>
  
  <script>
    // Navigation
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.content-section');
    const pageTitle = document.getElementById('pageTitle');
    
    const sectionTitles = {
      dashboard: 'Dashboard',
      settings: 'Configuración',
      'mercado-libre': 'Mercado Libre',
      user: 'Usuario'
    };
    
    navLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.getAttribute('data-section');
        
        // Update active nav
        navLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        
        // Show section
        sections.forEach(s => s.classList.remove('active'));
        document.getElementById(section + '-section').classList.add('active');
        
        // Update title
        pageTitle.textContent = sectionTitles[section];
      });
    });
    
    // Dark Mode
    const darkModeToggle = document.getElementById('darkModeToggle');
    const html = document.documentElement;
    
    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    if (savedTheme === 'dark') {
      html.setAttribute('data-theme', 'dark');
      darkModeToggle.checked = true;
    }
    
    darkModeToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      } else {
        html.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
      }
    });
    
    // Change Password
    const changePasswordForm = document.getElementById('changePasswordForm');
    const passwordAlert = document.getElementById('passwordAlert');
    
    function showAlert(message, type) {
      passwordAlert.textContent = message;
      passwordAlert.className = \`alert alert-\${type} show\`;
      setTimeout(() => {
        passwordAlert.classList.remove('show');
      }, 5000);
    }
    
    changePasswordForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('changePasswordBtn');
      const currentPassword = document.getElementById('currentPassword').value;
      const newPassword = document.getElementById('newPassword').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      
      if (newPassword !== confirmPassword) {
        showAlert('Las contraseñas no coinciden', 'error');
        return;
      }
      
      if (newPassword.length < 8) {
        showAlert('La contraseña debe tener al menos 8 caracteres', 'error');
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Cambiando...';
      
      try {
        const response = await fetch('/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            currentPassword,
            newPassword
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          showAlert('Contraseña cambiada exitosamente', 'success');
          changePasswordForm.reset();
        } else {
          showAlert(data.error?.message || 'Error al cambiar la contraseña', 'error');
        }
      } catch (error) {
        showAlert('Error de conexión', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Cambiar Contraseña';
      }
    });
    
    // Global Sellers
    const mlAlert = document.getElementById('mlAlert');
    const modal = document.getElementById('globalSellerModal');
    const modalTitle = document.getElementById('modalTitle');
    const globalSellerForm = document.getElementById('globalSellerForm');
    const modalAlert = document.getElementById('modalAlert');
    const addGlobalSellerBtn = document.getElementById('addGlobalSellerBtn');
    const closeModalBtn = document.getElementById('closeModal');
    const cancelModalBtn = document.getElementById('cancelModalBtn');
    const globalSellersTableBody = document.getElementById('globalSellersTableBody');
    let editingGlobalSellerId = null;
    
    function showMLAlert(message, type) {
      mlAlert.textContent = message;
      mlAlert.className = \`alert alert-\${type} show\`;
      setTimeout(() => {
        mlAlert.classList.remove('show');
      }, 5000);
    }
    
    function showModalAlert(message, type) {
      modalAlert.textContent = message;
      modalAlert.className = \`alert alert-\${type} show\`;
      setTimeout(() => {
        modalAlert.classList.remove('show');
      }, 5000);
    }
    
    function formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = new Date(timestamp * 1000);
      return date.toLocaleString('es-ES', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    
    function openModal(globalSeller = null) {
      editingGlobalSellerId = globalSeller ? globalSeller.id : null;
      modalTitle.textContent = globalSeller ? 'Editar Global Seller' : 'Agregar Global Seller';
      document.getElementById('globalSellerId').value = globalSeller ? globalSeller.id : '';
      document.getElementById('globalSellerName').value = globalSeller ? (globalSeller.name || '') : '';
      document.getElementById('globalSellerMLUserId').value = globalSeller ? globalSeller.ml_user_id : '';
      document.getElementById('globalSellerMLAccessToken').value = '';
      modalAlert.classList.remove('show');
      modal.classList.add('show');
    }
    
    function closeModal() {
      modal.classList.remove('show');
      globalSellerForm.reset();
      editingGlobalSellerId = null;
      modalAlert.classList.remove('show');
    }
    
    async function loadGlobalSellers() {
      try {
        const response = await fetch('/api/global-sellers', {
          credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
          renderGlobalSellersTable(data.data.globalSellers);
        } else {
          globalSellersTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 32px; color: var(--text-secondary);">Error al cargar los Global Sellers</td></tr>';
        }
      } catch (error) {
        console.error('Error loading global sellers:', error);
        globalSellersTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 32px; color: var(--text-secondary);">Error de conexión</td></tr>';
      }
    }
    
    function renderGlobalSellersTable(globalSellers) {
      if (globalSellers.length === 0) {
        globalSellersTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 32px; color: var(--text-secondary);">No hay Global Sellers. Haz clic en "Agregar Global Seller" para crear uno.</td></tr>';
        return;
      }
      
      globalSellersTableBody.innerHTML = globalSellers.map(gs => \`
        <tr>
          <td>\${gs.name || '-'}</td>
          <td>\${gs.ml_user_id}</td>
          <td>\${formatDate(gs.created_at)}</td>
          <td>
            <div class="table-actions">
              <button class="btn btn-secondary btn-icon" onclick="editGlobalSeller('\${gs.id}')">Editar</button>
              <button class="btn btn-danger btn-icon" onclick="deleteGlobalSeller('\${gs.id}')">Eliminar</button>
            </div>
          </td>
        </tr>
      \`).join('');
    }
    
    async function editGlobalSeller(id) {
      try {
        const response = await fetch('/api/global-sellers', {
          credentials: 'include'
        });
        const data = await response.json();
        
        if (data.success) {
          const globalSeller = data.data.globalSellers.find(gs => gs.id === id);
          if (globalSeller) {
            openModal(globalSeller);
          }
        }
      } catch (error) {
        showMLAlert('Error al cargar el Global Seller', 'error');
      }
    }
    
    async function deleteGlobalSeller(id) {
      if (!confirm('¿Estás seguro de que deseas eliminar este Global Seller?')) {
        return;
      }
      
      try {
        const response = await fetch(\`/api/global-sellers/\${id}\`, {
          method: 'DELETE',
          credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
          showMLAlert('Global Seller eliminado exitosamente', 'success');
          await loadGlobalSellers();
        } else {
          showMLAlert(data.error?.message || 'Error al eliminar el Global Seller', 'error');
        }
      } catch (error) {
        showMLAlert('Error de conexión', 'error');
      }
    }
    
    // Make functions global for onclick handlers
    window.editGlobalSeller = editGlobalSeller;
    window.deleteGlobalSeller = deleteGlobalSeller;
    
    // Load global sellers on page load
    loadGlobalSellers();
    
    // Modal handlers
    addGlobalSellerBtn.addEventListener('click', () => openModal());
    closeModalBtn.addEventListener('click', closeModal);
    cancelModalBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeModal();
      }
    });
    
    // Form submit
    globalSellerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submitGlobalSellerBtn');
      const name = document.getElementById('globalSellerName').value.trim();
      const mlUserId = document.getElementById('globalSellerMLUserId').value.trim();
      const mlAccessToken = document.getElementById('globalSellerMLAccessToken').value.trim();
      
      if (!mlUserId || !mlAccessToken) {
        showModalAlert('Por favor completa todos los campos requeridos', 'error');
        return;
      }
      
      btn.disabled = true;
      btn.textContent = 'Guardando...';
      
      try {
        const url = editingGlobalSellerId 
          ? \`/api/global-sellers/\${editingGlobalSellerId}\`
          : '/api/global-sellers';
        const method = editingGlobalSellerId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            name: name || undefined,
            mlUserId,
            mlAccessToken
          })
        });
        
        const data = await response.json();
        
        if (data.success) {
          showMLAlert(editingGlobalSellerId ? 'Global Seller actualizado exitosamente' : 'Global Seller creado exitosamente', 'success');
          closeModal();
          await loadGlobalSellers();
        } else {
          showModalAlert(data.error?.message || 'Error al guardar el Global Seller', 'error');
        }
      } catch (error) {
        showModalAlert('Error de conexión', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Guardar';
      }
    });
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
