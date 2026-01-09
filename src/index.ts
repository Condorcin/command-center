import { signupHandler, loginHandler, logoutHandler, meHandler, changePasswordHandler } from './routes/auth';
import { dashboardHandler } from './routes/dashboard';
import { saveCredentialsHandler, clearCredentialsHandler, getCredentialsStatusHandler } from './routes/mercado-libre';
import { globalSellerDetailsHandler } from './routes/global-seller-details';
import { getGlobalSellersHandler, getGlobalSellerByIdHandler, createGlobalSellerHandler, updateGlobalSellerHandler, deleteGlobalSellerHandler } from './routes/global-seller';
import { getItemsCountHandler, getItemsHandler, syncItemsHandler, getSyncStatusHandler, loadItemsHandler, getSavedItemsHandler, checkItemsHandler } from './routes/global-seller-items';
import { errorResponse } from './utils/response';
import { getCookie } from './utils/cookies';
import { AuthService } from './services/auth.service';
import { UserRepository } from './repositories/user.repository';
import { SessionRepository } from './repositories/session.repository';
import { logger } from './utils/logger';

export interface Env {
  DB: D1Database;
}

/**
 * Main request handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // CORS headers for development
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      // Handle OPTIONS requests
      if (method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders,
        });
      }

      // Route handling
      let response: Response;

      // Public routes
      if (path === '/' && method === 'GET') {
        response = await homeHandler(request, env);
      } else if (path === '/auth/signup' && method === 'POST') {
        response = await signupHandler(request, env);
      } else if (path === '/auth/login' && method === 'POST') {
        response = await loginHandler(request, env);
      } else if (path === '/auth/login' && method === 'GET') {
        response = await loginPageHandler(request, env);
      } else if (path === '/auth/logout' && method === 'POST') {
        response = await logoutHandler(request, env);
      } else if (path === '/auth/me' && method === 'GET') {
        response = await meHandler(request, env);
      } else if (path === '/auth/change-password' && method === 'POST') {
        response = await changePasswordHandler(request, env);
      } else if (path === '/api/mercado-libre/credentials' && method === 'POST') {
        response = await saveCredentialsHandler(request, env);
      } else if (path === '/api/mercado-libre/credentials' && method === 'GET') {
        response = await getCredentialsStatusHandler(request, env);
      } else if (path === '/api/mercado-libre/credentials' && method === 'DELETE') {
        response = await clearCredentialsHandler(request, env);
      } else if (path === '/api/global-sellers' && method === 'GET') {
        response = await getGlobalSellersHandler(request, env);
      } else if (path.match(/^\/api\/global-sellers\/[^/]+\/items\/count$/) && method === 'GET') {
        response = await getItemsCountHandler(request, env);
      } else if (path.match(/^\/api\/global-sellers\/[^/]+\/items\/sync-status$/) && method === 'GET') {
        response = await getSyncStatusHandler(request, env);
      } else if (path.match(/^\/api\/global-sellers\/[^/]+\/items\/saved$/) && method === 'GET') {
        response = await getSavedItemsHandler(request, env);
      } else if (path.match(/^\/api\/global-sellers\/[^/]+\/items\/sync$/) && method === 'POST') {
        response = await syncItemsHandler(request, env);
      } else if (path.match(/^\/api\/global-sellers\/[^/]+\/items\/check$/) && method === 'POST') {
        response = await checkItemsHandler(request, env);
      } else if (path.match(/^\/api\/global-sellers\/[^/]+\/items\/load$/) && method === 'POST') {
        response = await loadItemsHandler(request, env);
      } else if (path.match(/^\/api\/global-sellers\/[^/]+\/items$/) && method === 'GET') {
        response = await getItemsHandler(request, env);
      } else if (path.startsWith('/api/global-sellers/') && method === 'GET') {
        response = await getGlobalSellerByIdHandler(request, env);
      } else if (path === '/api/global-sellers' && method === 'POST') {
        response = await createGlobalSellerHandler(request, env);
      } else if (path.startsWith('/api/global-sellers/') && method === 'PUT') {
        response = await updateGlobalSellerHandler(request, env);
      } else if (path.startsWith('/api/global-sellers/') && method === 'DELETE') {
        response = await deleteGlobalSellerHandler(request, env);
      } else if (path === '/dashboard' && method === 'GET') {
        response = await dashboardHandler(request, env);
      } else if (path.startsWith('/dashboard/global-seller/') && method === 'GET') {
        response = await globalSellerDetailsHandler(request, env);
      } else if (path === '/favicon.svg' && method === 'GET') {
        response = faviconHandler();
      } else {
        response = errorResponse('Not found', 404, 'NOT_FOUND');
      }

      // Add CORS headers to all responses (skip for redirects)
      if (response.status < 300 || response.status >= 400) {
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value);
        });
      }

      return response;
    } catch (error) {
      logger.error('Unhandled error:', error);
      return errorResponse('Internal server error', 500, 'INTERNAL_ERROR');
    }
  },
};

/**
 * Home page handler - redirects to login or dashboard
 */
async function homeHandler(request: Request, env: Env): Promise<Response> {
  try {
    // Si no hay DB disponible, redirigir a login
    if (!env.DB) {
      return Response.redirect(new URL('/auth/login', request.url).toString(), 302);
    }

    const sessionId = getCookie(request, 'session_id');
    
    if (sessionId) {
      try {
        const userRepo = new UserRepository(env.DB);
        const sessionRepo = new SessionRepository(env.DB);
        const authService = new AuthService(userRepo, sessionRepo);
        
        const user = await authService.getUserFromSession(sessionId);
        if (user) {
          return Response.redirect(new URL('/dashboard', request.url).toString(), 302);
        }
      } catch (dbError) {
        // Si hay error con la DB, simplemente redirigir a login
        logger.error('Database error in homeHandler:', dbError);
      }
    }

    return Response.redirect(new URL('/auth/login', request.url).toString(), 302);
  } catch (error) {
    // Si hay error, simplemente redirigir a login
    logger.error('Error in homeHandler:', error);
    return Response.redirect(new URL('/auth/login', request.url).toString(), 302);
  }
}

/**
 * Login page handler
 */
async function loginPageHandler(request: Request, env: Env): Promise<Response> {
  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orbix - Iniciar Sesión</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .container {
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
      max-width: 400px;
      width: 100%;
    }
    
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    
    .logo-icon {
      width: 60px;
      height: 60px;
      margin: 0 auto 20px;
      position: relative;
    }
    
    .logo-icon::before {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      background: radial-gradient(circle at 30% 30%, #3b82f6, #1e40af);
      border-radius: 50%;
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.4);
    }
    
    .logo-icon::after {
      content: '';
      position: absolute;
      width: 120%;
      height: 120%;
      top: -10%;
      left: -10%;
      border: 3px solid rgba(59, 130, 246, 0.3);
      border-radius: 50%;
      border-top-color: rgba(59, 130, 246, 0.8);
      animation: orbit 3s linear infinite;
    }
    
    @keyframes orbit {
      to { transform: rotate(360deg); }
    }
    
    h1 {
      color: #1f2937;
      font-size: 28px;
      font-weight: 700;
    }
    
    .orbix-text {
      color: #3b82f6;
    }
    
    .form-group {
      margin-bottom: 20px;
    }
    
    label {
      display: block;
      color: #374151;
      font-weight: 500;
      margin-bottom: 8px;
      font-size: 14px;
    }
    
    input {
      width: 100%;
      padding: 12px;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      font-size: 16px;
      transition: border-color 0.2s;
    }
    
    input:focus {
      outline: none;
      border-color: #3b82f6;
    }
    
    .btn {
      width: 100%;
      padding: 12px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: 15px;
    }
    
    .btn:hover {
      background: #2563eb;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
    }
    
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    
    .link {
      text-align: center;
      color: #6b7280;
      font-size: 14px;
    }
    
    .link a {
      color: #3b82f6;
      text-decoration: none;
      font-weight: 500;
    }
    
    .link a:hover {
      text-decoration: underline;
    }
    
    .error {
      background: #fee2e2;
      color: #991b1b;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }
    
    .error.show {
      display: block;
    }
    
    .success {
      background: #d1fae5;
      color: #065f46;
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      display: none;
    }
    
    .success.show {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">
      <div class="logo-icon"></div>
      <h1><span class="orbix-text">Orbix</span></h1>
    </div>
    
    <div id="error" class="error"></div>
    <div id="success" class="success"></div>
    
    <form id="loginForm">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" required autocomplete="email">
      </div>
      
      <div class="form-group">
        <label for="password">Contraseña</label>
        <input type="password" id="password" name="password" required autocomplete="current-password">
      </div>
      
      <button type="submit" class="btn" id="submitBtn">Iniciar Sesión</button>
    </form>
    
    <div class="link">
      ¿No tienes cuenta? <a href="#" onclick="showSignup(); return false;">Regístrate</a>
    </div>
    
    <form id="signupForm" style="display: none;">
      <div class="form-group">
        <label for="signupEmail">Email</label>
        <input type="email" id="signupEmail" name="email" required autocomplete="email">
      </div>
      
      <div class="form-group">
        <label for="signupPassword">Contraseña</label>
        <input type="password" id="signupPassword" name="password" required autocomplete="new-password" minlength="8">
        <small style="color: #6b7280; font-size: 12px; margin-top: 4px; display: block;">
          Mínimo 8 caracteres con letras y números
        </small>
      </div>
      
      <button type="submit" class="btn" id="signupSubmitBtn">Registrarse</button>
    </form>
    
    <div class="link" id="signupLink" style="display: none;">
      ¿Ya tienes cuenta? <a href="#" onclick="showLogin(); return false;">Inicia sesión</a>
    </div>
  </div>
  
  <script>
    function showError(message) {
      const errorEl = document.getElementById('error');
      errorEl.textContent = message;
      errorEl.classList.add('show');
      setTimeout(() => errorEl.classList.remove('show'), 5000);
    }
    
    function showSuccess(message) {
      const successEl = document.getElementById('success');
      successEl.textContent = message;
      successEl.classList.add('show');
      setTimeout(() => successEl.classList.remove('show'), 5000);
    }
    
    function showSignup() {
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('signupForm').style.display = 'block';
      document.querySelectorAll('.link')[0].style.display = 'none';
      document.getElementById('signupLink').style.display = 'block';
    }
    
    function showLogin() {
      document.getElementById('loginForm').style.display = 'block';
      document.getElementById('signupForm').style.display = 'none';
      document.querySelectorAll('.link')[0].style.display = 'block';
      document.getElementById('signupLink').style.display = 'none';
    }
    
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('submitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Iniciando sesión...';
      
      try {
        const formData = new FormData(e.target);
        const response = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: formData.get('email'),
            password: formData.get('password'),
          }),
        });
        
        const data = await response.json();
        
        if (data.success) {
          showSuccess('¡Bienvenido! Redirigiendo...');
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 1000);
        } else {
          showError(data.error?.message || 'Error al iniciar sesión');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Iniciar Sesión';
        }
      } catch (error) {
        showError('Error de conexión');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Iniciar Sesión';
      }
    });
    
    document.getElementById('signupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('signupSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Registrando...';
      
      try {
        const formData = new FormData(e.target);
        const response = await fetch('/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            email: formData.get('email'),
            password: formData.get('password'),
          }),
        });
        
        const data = await response.json();
        
        if (data.success) {
          showSuccess('¡Cuenta creada! Redirigiendo...');
          setTimeout(() => {
            window.location.href = '/dashboard';
          }, 1000);
        } else {
          showError(data.error?.message || 'Error al registrarse');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Registrarse';
        }
      } catch (error) {
        showError('Error de conexión');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Registrarse';
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
}

/**
 * Favicon handler - returns a simple SVG favicon
 */
function faviconHandler(): Response {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3b82f6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#1e40af;stop-opacity:1" />
    </linearGradient>
  </defs>
  
  <!-- Central sphere -->
  <circle cx="50" cy="50" r="15" fill="url(#grad1)" opacity="0.9"/>
  
  <!-- Orbital paths -->
  <ellipse cx="50" cy="50" rx="35" ry="20" fill="none" stroke="#3b82f6" stroke-width="2" opacity="0.6" transform="rotate(-30 50 50)"/>
  <ellipse cx="50" cy="50" rx="30" ry="30" fill="none" stroke="#60a5fa" stroke-width="1.5" opacity="0.4"/>
  
  <!-- Electron/satellite -->
  <circle cx="85" cy="50" r="4" fill="#3b82f6"/>
</svg>
  `;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=31536000',
    },
  });
}

