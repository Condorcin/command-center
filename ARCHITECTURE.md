# Arquitectura de Orbix

## Decisiones Técnicas

### Autenticación y Sesiones

**Flujo de Autenticación:**
1. Usuario se registra o inicia sesión
2. Password se hashea con PBKDF2 (100,000 iteraciones)
3. Se crea una sesión en D1 con ID único
4. Session ID se almacena en cookie segura (httpOnly, secure, sameSite)
5. Cada request autenticado valida la sesión contra D1

**Por qué PBKDF2 en lugar de bcrypt:**
- Cloudflare Workers no soporta bcrypt nativamente
- PBKDF2 es compatible con Web Crypto API
- Nivel de seguridad equivalente con 100k iteraciones
- Implementación usando `@noble/hashes` (cryptographically secure)

**Manejo de Sesiones:**
- Sesiones almacenadas en D1 (no KV) para permitir queries y limpieza
- Expiración automática: 7 días
- Limpieza de sesiones expiradas disponible vía `cleanupExpiredSessions()`
- Una sesión por login (no múltiples dispositivos por ahora)

### Estructura de Capas

```
Routes → Services → Repositories → Database
```

**Routes (`/routes`):**
- Manejan HTTP requests/responses
- Validan inputs
- Llaman a servicios
- Formatean respuestas

**Services (`/services`):**
- Contienen lógica de negocio
- Orquestan múltiples repositorios
- No conocen detalles de HTTP

**Repositories (`/repositories`):**
- Acceso a datos
- Abstracción de D1
- Queries SQL

**Utils (`/utils`):**
- Funciones puras reutilizables
- Sin dependencias de negocio

### Base de Datos

**Esquema:**
- `users`: Información de usuarios
- `sessions`: Sesiones activas con expiración

**Índices:**
- `users.email`: Búsqueda rápida por email
- `sessions.user_id`: Búsqueda de sesiones por usuario
- `sessions.expires_at`: Limpieza eficiente de expiradas

**Migraciones:**
- Usar sistema de migraciones de Wrangler
- Archivos en `/migrations` con prefijo numérico

### Seguridad

**Cookies:**
- `httpOnly`: Previene acceso desde JavaScript
- `secure`: Solo sobre HTTPS (en producción)
- `sameSite: Strict`: Previene CSRF
- `Max-Age`: 7 días

**Validación:**
- Email: Regex estándar
- Password: Mínimo 8 caracteres, letras y números
- Validación en capa de routes antes de procesar

**Errores:**
- No exponer detalles internos
- Mensajes genéricos para usuarios
- Códigos de error para debugging

### Escalabilidad

**Roles:**
- Campo `role` en tabla users
- Por defecto: "operator"
- Fácil agregar nuevos roles sin refactor
- Validación de roles en middleware (futuro)

**Extensibilidad:**
- Estructura modular permite agregar features
- Repositorios separados por entidad
- Servicios por dominio de negocio

### Limitaciones Actuales

- No multi-tenancy (un solo tenant por ahora)
- No permisos granulares (solo roles)
- No refresh tokens (sesiones simples)
- No rate limiting (agregar en producción)
- No logging estructurado (usar console.log por ahora)

### Mejoras Futuras

1. **Multi-tenancy:**
   - Agregar tabla `tenants`
   - Foreign key `tenant_id` en users
   - Middleware para validar tenant

2. **Permisos:**
   - Tabla `permissions`
   - Tabla `role_permissions`
   - Validación en middleware

3. **Refresh Tokens:**
   - Tokens de corta duración (access)
   - Tokens de larga duración (refresh)
   - Rotación de tokens

4. **Rate Limiting:**
   - Usar Cloudflare Rate Limiting
   - O implementar con KV

5. **Logging:**
   - Integrar con Cloudflare Analytics
   - Structured logging con niveles

