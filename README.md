# Orbix

SaaS platform bootstrap con autenticación basado en Cloudflare Workers.

## 🚀 Características

- ✅ Autenticación completa (signup, login, logout)
- ✅ Sesiones persistentes con cookies seguras
- ✅ Passwords hasheadas con PBKDF2
- ✅ Base de datos Cloudflare D1
- ✅ Arquitectura escalable y mantenible
- ✅ TypeScript
- ✅ Vista de bienvenida después del login

## 📋 Requisitos Previos

- Node.js 18+ 
- npm o yarn
- Cuenta de Cloudflare
- Wrangler CLI (se instala automáticamente con npm install)

## 🛠️ Instalación

1. Instalar dependencias:
```bash
npm install
```

2. Crear base de datos D1:
```bash
npm run db:create
```

3. Actualizar `wrangler.toml` con los IDs de la base de datos generados.

4. Ejecutar migraciones localmente:
```bash
npm run db:migrate:local
```

## 🏃 Desarrollo

Iniciar el servidor de desarrollo:
```bash
npm run dev
```

El worker estará disponible en `http://localhost:8787`

## 📦 Despliegue

1. Ejecutar migraciones en producción:
```bash
npm run db:migrate
```

2. Desplegar el worker:
```bash
npm run deploy
```

## 📁 Estructura del Proyecto

```
.
├── src/
│   ├── db/
│   │   └── schema.ts          # Tipos TypeScript para DB
│   ├── middlewares/
│   │   └── auth.ts            # Middleware de autenticación
│   ├── repositories/
│   │   ├── user.repository.ts # Acceso a datos de usuarios
│   │   └── session.repository.ts # Acceso a datos de sesiones
│   ├── routes/
│   │   ├── auth.ts            # Endpoints de autenticación
│   │   └── dashboard.ts       # Vista de dashboard
│   ├── services/
│   │   └── auth.service.ts    # Lógica de negocio de auth
│   ├── utils/
│   │   ├── crypto.ts          # Hashing de passwords
│   │   ├── cookies.ts         # Manejo de cookies
│   │   ├── validation.ts      # Validación de inputs
│   │   └── response.ts        # Helpers de respuesta
│   └── index.ts               # Worker principal
├── migrations/
│   └── 0001_initial_schema.sql # Migración inicial
├── wrangler.toml              # Configuración de Cloudflare
└── package.json
```

## 🔐 Endpoints

### Autenticación

- `POST /auth/signup` - Registrar nuevo usuario
- `POST /auth/login` - Iniciar sesión
- `POST /auth/logout` - Cerrar sesión
- `GET /auth/me` - Obtener usuario actual

### Páginas

- `GET /` - Redirige a login o dashboard
- `GET /auth/login` - Página de login
- `GET /dashboard` - Dashboard (requiere autenticación)

## 🔒 Seguridad

- Passwords hasheadas con PBKDF2 (100,000 iteraciones)
- Cookies seguras (httpOnly, secure, sameSite)
- Validación de inputs
- Sesiones con expiración (7 días)
- Protección de rutas privadas

## 📝 Notas Técnicas

Ver [ARCHITECTURE.md](./ARCHITECTURE.md) para detalles sobre decisiones de arquitectura.

## 🎯 Próximos Pasos

Este es el bootstrap inicial. El sistema está preparado para:
- Agregar nuevos roles fácilmente
- Integrar con Mercado Libre (futuro)
- Expandir funcionalidades sin refactor mayor
