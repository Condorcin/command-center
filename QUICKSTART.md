# Quick Start Guide

## Configuración Inicial

### 1. Instalar Dependencias
```bash
npm install
```

### 2. Crear Base de Datos D1

**En Cloudflare Dashboard:**
1. Ve a Workers & Pages → D1
2. Crea una nueva base de datos llamada `orbix-db`
3. Copia el `database_id` y `preview_database_id`

**O usando CLI:**
```bash
npm run db:create
```

### 3. Configurar wrangler.toml

Edita `wrangler.toml` y reemplaza:
- `database_id` con el ID de producción
- `preview_database_id` con el ID de preview

### 4. Ejecutar Migraciones

**Local (desarrollo):**
```bash
npm run db:migrate:local
```

**Producción:**
```bash
npm run db:migrate
```

### 5. Iniciar Desarrollo

```bash
npm run dev
```

Abre `http://localhost:8787` en tu navegador.

## Probar la Aplicación

### Registrar Usuario
1. Ve a `http://localhost:8787/auth/login`
2. Haz clic en "Regístrate"
3. Ingresa email y password (mínimo 8 caracteres con letras y números)
4. Serás redirigido al dashboard

### Iniciar Sesión
1. Ve a `http://localhost:8787/auth/login`
2. Ingresa tus credenciales
3. Serás redirigido al dashboard

### Verificar Sesión
```bash
curl http://localhost:8787/auth/me \
  -H "Cookie: session_id=TU_SESSION_ID"
```

## Estructura de Respuestas

### Éxito
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "message": "Error message",
    "code": "ERROR_CODE",
    "details": { ... }
  }
}
```

## Endpoints Disponibles

| Método | Endpoint | Descripción | Auth |
|--------|----------|-------------|------|
| GET | `/` | Redirige a login/dashboard | No |
| GET | `/auth/login` | Página de login | No |
| POST | `/auth/signup` | Registrar usuario | No |
| POST | `/auth/login` | Iniciar sesión | No |
| POST | `/auth/logout` | Cerrar sesión | Sí |
| GET | `/auth/me` | Obtener usuario actual | Sí |
| GET | `/dashboard` | Dashboard de bienvenida | Sí |

## Troubleshooting

### Error: "Database not found"
- Verifica que los IDs en `wrangler.toml` sean correctos
- Asegúrate de haber ejecutado las migraciones

### Error: "Unauthorized"
- Verifica que la cookie `session_id` esté presente
- La sesión puede haber expirado (7 días)

### Error al hashear password
- Verifica que `@noble/hashes` esté instalado
- Asegúrate de usar Node.js 18+

## Próximos Pasos

1. Configurar variables de entorno en producción
2. Agregar rate limiting
3. Implementar logging estructurado
4. Agregar tests




