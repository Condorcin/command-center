# API REST Documentation

Esta es una API REST construida con Cloudflare Workers que gestiona usuarios, vendedores globales, items de Mercado Libre y sincronización de datos.

## Base URL

- **Desarrollo**: `http://localhost:8787`
- **Producción**: (configurar según tu dominio de Cloudflare)

## Autenticación

La API usa cookies de sesión para autenticación. Después de hacer login, se establece una cookie `session_id` que debe enviarse en todas las peticiones autenticadas.

## Formato de Respuesta

Todas las respuestas siguen este formato:

### Respuesta Exitosa
```json
{
  "success": true,
  "data": { ... }
}
```

### Respuesta de Error
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

## Modelos de Datos

### User
```typescript
interface User {
  id: string;
  email: string;
  role: 'operator' | 'admin' | 'super_admin';
  created_at: number;
  ml_user_id?: string | null;
  ml_access_token?: string | null;
  ml_updated_at?: number | null;
}
```

### GlobalSeller
```typescript
interface GlobalSeller {
  id: string;
  user_id: string;
  ml_user_id: string;
  ml_access_token: string; // No se expone en respuestas
  name?: string | null;
  created_at: number;
  updated_at: number;
  // Información de Mercado Libre
  ml_nickname?: string | null;
  ml_email?: string | null;
  ml_first_name?: string | null;
  ml_last_name?: string | null;
  ml_country_id?: string | null;
  ml_site_id?: string | null;
  ml_registration_date?: string | null;
  ml_phone?: string | null;
  ml_address?: string | null;
  ml_city?: string | null;
  ml_state?: string | null;
  ml_zip_code?: string | null;
  ml_tax_id?: string | null;
  ml_corporate_name?: string | null;
  ml_brand_name?: string | null;
  ml_seller_experience?: string | null;
  ml_info_updated_at?: number | null;
}
```

### Item
```typescript
interface Item {
  id: string;
  global_seller_id: string;
  ml_item_id: string; // ID del item en Mercado Libre (ej: "CBT123456")
  site_id: string | null;
  title: string | null;
  price: number | null;
  currency_id: string | null;
  available_quantity: number;
  sold_quantity: number;
  status: 'active' | 'paused' | 'closed';
  listing_type_id: string | null;
  condition: string | null;
  permalink: string | null;
  thumbnail: string | null;
  category_id: string | null;
  start_time: number | null; // Unix timestamp
  stop_time: number | null; // Unix timestamp
  end_time: number | null; // Unix timestamp
  created_at: number;
  updated_at: number;
  synced_at: number | null;
  metadata: string | null; // JSON string con respuesta completa de ML API
}
```

### MarketplaceItem
```typescript
interface MarketplaceItem {
  id: string;
  item_id: string; // Referencia a items.id
  global_seller_id: string;
  ml_item_id: string; // ID del marketplace item (ej: "MLC1818643789")
  site_id: string; // País (ej: "MLC", "MCO", "MLB", "MLM")
  date_created: string | null; // ISO date string
  created_at: number;
  updated_at: number;
  performance_score?: number | null; // 0-100
  performance_level?: string | null; // 'Bad', 'Average', 'Good'
  performance_level_wording?: string | null;
  performance_calculated_at?: string | null;
  performance_data?: string | null; // JSON string
}
```

## Endpoints

### Autenticación

#### POST /auth/signup
Registrar un nuevo usuario.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "operator",
      "created_at": 1234567890
    }
  }
}
```

**Códigos de Estado:**
- `200`: Registro exitoso
- `400`: Validación fallida
- `409`: Email ya existe

---

#### POST /auth/login
Iniciar sesión.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "operator",
      "created_at": 1234567890
    }
  }
}
```

**Códigos de Estado:**
- `200`: Login exitoso (cookie `session_id` establecida)
- `401`: Credenciales inválidas

---

#### POST /auth/logout
Cerrar sesión.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully"
  }
}
```

**Códigos de Estado:**
- `200`: Logout exitoso

---

#### GET /auth/me
Obtener información del usuario actual.

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "user@example.com",
      "role": "operator",
      "created_at": 1234567890
    }
  }
}
```

**Códigos de Estado:**
- `200`: Usuario encontrado
- `401`: No autenticado

---

#### POST /auth/change-password
Cambiar contraseña del usuario actual.

**Request Body:**
```json
{
  "currentPassword": "oldpassword123",
  "newPassword": "newpassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Password changed successfully"
  }
}
```

**Códigos de Estado:**
- `200`: Contraseña cambiada
- `400`: Validación fallida
- `401`: Contraseña actual incorrecta

---

### Global Sellers

#### GET /api/global-sellers
Obtener todos los global sellers del usuario autenticado.

**Response:**
```json
{
  "success": true,
  "data": {
    "globalSellers": [
      {
        "id": "uuid",
        "user_id": "uuid",
        "ml_user_id": "123456789",
        "name": "Mi Tienda",
        "created_at": 1234567890,
        "updated_at": 1234567890,
        "ml_nickname": "MI_TIENDA",
        "ml_email": "tienda@example.com",
        ...
      }
    ]
  }
}
```

**Códigos de Estado:**
- `200`: Lista obtenida
- `401`: No autenticado

---

#### GET /api/global-sellers/:id
Obtener un global seller por ID.

**Response:**
```json
{
  "success": true,
  "data": {
    "globalSeller": {
      "id": "uuid",
      "user_id": "uuid",
      "ml_user_id": "123456789",
      ...
    }
  }
}
```

**Códigos de Estado:**
- `200`: Global seller encontrado
- `401`: No autenticado
- `403`: Acceso denegado
- `404`: No encontrado

---

#### POST /api/global-sellers
Crear un nuevo global seller.

**Request Body:**
```json
{
  "ml_user_id": "123456789",
  "ml_access_token": "APP_USR-...",
  "name": "Mi Tienda"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "globalSeller": {
      "id": "uuid",
      "user_id": "uuid",
      "ml_user_id": "123456789",
      ...
    }
  }
}
```

**Códigos de Estado:**
- `200`: Global seller creado
- `400`: Validación fallida
- `401`: No autenticado

---

#### PUT /api/global-sellers/:id
Actualizar un global seller.

**Request Body:**
```json
{
  "name": "Nuevo Nombre",
  "ml_access_token": "APP_USR-..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "globalSeller": {
      "id": "uuid",
      ...
    }
  }
}
```

**Códigos de Estado:**
- `200`: Actualizado
- `400`: Validación fallida
- `401`: No autenticado
- `403`: Acceso denegado
- `404`: No encontrado

---

#### DELETE /api/global-sellers/:id
Eliminar un global seller.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Global seller deleted successfully"
  }
}
```

**Códigos de Estado:**
- `200`: Eliminado
- `401`: No autenticado
- `403`: Acceso denegado
- `404`: No encontrado

---

#### POST /api/global-sellers/:id/clear
Limpiar todos los datos de un global seller (items, marketplace items, etc.).

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Global seller data cleared successfully"
  }
}
```

**Códigos de Estado:**
- `200`: Datos limpiados
- `401`: No autenticado
- `403`: Acceso denegado
- `404`: No encontrado

---

### Items / CBTs

#### GET /api/global-sellers/:id/items/count
Obtener conteo de items por estado desde Mercado Libre.

**Response:**
```json
{
  "success": true,
  "data": {
    "active": 360002,
    "paused": 36338,
    "closed": 510,
    "total": 396850
  }
}
```

**Códigos de Estado:**
- `200`: Conteo obtenido
- `401`: No autenticado
- `403`: Acceso denegado
- `404`: No encontrado

---

#### GET /api/global-sellers/:id/cbts/count
Obtener conteo de CBTs guardados en la base de datos.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 396843
  }
}
```

---

#### GET /api/global-sellers/:id/cbts/saved
Obtener CBTs guardados con paginación.

**Query Parameters:**
- `page` (number, default: 1): Número de página
- `limit` (number, default: 200, max: 200): Items por página

**Response:**
```json
{
  "success": true,
  "data": {
    "cbts": [
      {
        "id": "uuid",
        "ml_item_id": "CBT123456",
        "title": "Producto Ejemplo",
        "price": 1000,
        "status": "active",
        "sold_quantity": 5,
        "thumbnail": "https://...",
        "sync_log": "OK"
      }
    ],
    "paging": {
      "total": 396843,
      "page": 1,
      "totalPages": 1985,
      "limit": 200
    },
    "syncStats": {
      "synced": 15691,
      "notSynced": 381152
    }
  }
}
```

---

#### POST /api/global-sellers/:id/cbts/sync
Iniciar sincronización de CBTs usando scan mode de Mercado Libre.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Sync started in background",
    "status": "processing",
    "total": 396850
  }
}
```

**Nota:** Este proceso se ejecuta en background usando `ctx.waitUntil()`.

---

#### POST /api/global-sellers/:id/cbts/:cbtId/sync
Sincronizar un CBT individual (obtener detalles completos).

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "CBT synced successfully",
    "cbtId": "CBT123456"
  }
}
```

---

#### POST /api/global-sellers/:id/cbts/sync-all
Sincronizar todos los CBTs guardados en la base de datos (obtener detalles completos).

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Sync all started in background",
    "status": "processing",
    "total": 396843
  }
}
```

**Nota:** Proceso en background. Usa Multiget API (hasta 20 items por request).

---

#### POST /api/global-sellers/:id/cbts/sync-all/pause
Pausar la sincronización en curso.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Sync paused",
    "synced": 1000,
    "failed": 5,
    "currentBatchIndex": 50
  }
}
```

---

#### POST /api/global-sellers/:id/cbts/sync-all/resume
Reanudar la sincronización pausada.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Sync resumed",
    "synced": 1000,
    "failed": 5,
    "currentBatchIndex": 50
  }
}
```

---

#### POST /api/global-sellers/:id/cbts/sync-all/stop
Detener completamente la sincronización.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Sync stopped",
    "synced": 1000,
    "failed": 5
  }
}
```

---

#### POST /api/global-sellers/:id/cbts/continue-sync
Continuar sincronizando solo los CBTs que no han sido sincronizados.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Continue sync started in background",
    "status": "processing",
    "total": 381152
  }
}
```

**Nota:** Solo procesa CBTs que no tienen `sync_log: 'OK'` y no tienen `title` o `price`.

---

### Marketplace Items

#### GET /api/global-sellers/:id/marketplace-items
Obtener todos los marketplace items de un global seller.

**Response:**
```json
{
  "success": true,
  "data": {
    "marketplaceItems": [
      {
        "id": "uuid",
        "ml_item_id": "MLC1818643789",
        "site_id": "MLC",
        "date_created": "2024-01-01T00:00:00Z",
        "performance_score": 85,
        "performance_level": "Good",
        ...
      }
    ]
  }
}
```

---

#### GET /api/global-sellers/:id/items/:itemId/marketplace-items
Obtener marketplace items de un item específico.

**Response:**
```json
{
  "success": true,
  "data": {
    "marketplaceItems": [
      {
        "id": "uuid",
        "ml_item_id": "MLC1818643789",
        "site_id": "MLC",
        ...
      }
    ]
  }
}
```

---

### Performance

#### GET /api/global-sellers/:id/items/:itemId/performance
Obtener información de performance de un item.

**Response:**
```json
{
  "success": true,
  "data": {
    "performance": {
      "score": 85,
      "level": "Good",
      "level_wording": "Profesional",
      "calculated_at": "2024-01-01T00:00:00Z"
    }
  }
}
```

---

#### POST /api/global-sellers/:id/performance/sync
Sincronizar performance de todos los marketplace items.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Performance sync started",
    "status": "processing"
  }
}
```

---

### Mercado Libre Credentials

#### POST /api/mercado-libre/credentials
Guardar credenciales de Mercado Libre para el usuario.

**Request Body:**
```json
{
  "ml_user_id": "123456789",
  "ml_access_token": "APP_USR-..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Credentials saved successfully"
  }
}
```

---

#### GET /api/mercado-libre/credentials
Obtener estado de las credenciales de Mercado Libre.

**Response:**
```json
{
  "success": true,
  "data": {
    "hasCredentials": true,
    "ml_user_id": "123456789"
  }
}
```

---

#### DELETE /api/mercado-libre/credentials
Eliminar credenciales de Mercado Libre.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Credentials cleared successfully"
  }
}
```

---

## Códigos de Error Comunes

| Código | Descripción |
|--------|-------------|
| `400` | Bad Request - Validación fallida |
| `401` | Unauthorized - No autenticado |
| `403` | Forbidden - Acceso denegado |
| `404` | Not Found - Recurso no encontrado |
| `409` | Conflict - Recurso duplicado |
| `429` | Too Many Requests - Rate limit excedido |
| `500` | Internal Server Error - Error del servidor |

## CORS

La API incluye headers CORS para desarrollo:
- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type`

## Notas Técnicas

1. **Background Processing**: Algunos endpoints (como `sync`, `sync-all`) ejecutan procesos en background usando `ctx.waitUntil()` de Cloudflare Workers.

2. **Rate Limiting**: La API implementa rate limiting para las llamadas a Mercado Libre API con delays configurables.

3. **Token Expiration**: Si el token de Mercado Libre expira durante una sincronización, el proceso se pausa y se notifica al frontend.

4. **Metadata**: El campo `metadata` en `Item` contiene el JSON completo de la respuesta de Mercado Libre API, incluyendo todos los campos adicionales.

5. **Paginación**: Los endpoints que devuelven listas grandes (como `cbts/saved`) usan paginación con límite máximo de 200 items por página.

6. **Multiget**: La sincronización masiva usa la API Multiget de Mercado Libre que permite obtener hasta 20 items por request.
