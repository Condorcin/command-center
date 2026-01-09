# Guía de Testing - Cambios del PR

## Estado Actual
- **Rama actual**: `integracion-con-meli`
- **Cambios aplicados**: ✅ Todos los cambios recomendados del PR están en esta rama

## Cómo Probar los Cambios

### 1. Iniciar el servidor de desarrollo local

```bash
npm run dev
```

O directamente con wrangler:

```bash
wrangler dev
```

Esto iniciará el servidor en `http://localhost:8787` (o el puerto que indique wrangler)

### 2. Verificar que el código compila

```bash
npm run typecheck
```

Debería mostrar: ✅ Sin errores de TypeScript

### 3. Probar los endpoints modificados

#### A. Probar logging (verificar que no hay console.log en producción)

1. Abre la consola del navegador o los logs de wrangler
2. Realiza una petición a cualquier endpoint
3. **Verificar**: Solo deberías ver logs de nivel `error` o `warn` en producción
4. Los logs de `debug` solo aparecen en desarrollo

#### B. Probar validación de parámetros

**Endpoint**: `POST /api/global-sellers/:id/items/load`

**Prueba 1 - Parámetros válidos:**
```bash
curl -X POST http://localhost:8787/api/global-sellers/{id}/items/load \
  -H "Content-Type: application/json" \
  -H "Cookie: session_id=tu_session_id" \
  -d '{
    "status": "active",
    "order": "start_time_desc",
    "page": 0
  }'
```

**Prueba 2 - Parámetros inválidos (debería usar valores por defecto):**
```bash
curl -X POST http://localhost:8787/api/global-sellers/{id}/items/load \
  -H "Content-Type: application/json" \
  -H "Cookie: session_id=tu_session_id" \
  -d '{
    "status": "invalid_status",
    "order": "invalid_order",
    "page": -1
  }'
```

**Verificar**: Debería usar valores por defecto seguros sin errores

**Prueba 3 - Offset muy grande (debería rechazar):**
```bash
curl -X POST http://localhost:8787/api/global-sellers/{id}/items/load \
  -H "Content-Type: application/json" \
  -H "Cookie: session_id=tu_session_id" \
  -d '{
    "status": "active",
    "page": 300
  }'
```

**Verificar**: Debería retornar error 400 con mensaje sobre límite de paginación

#### C. Probar constantes centralizadas

Verificar que los límites están usando las constantes:

1. Abre `src/routes/global-seller-items.ts`
2. Busca `ML_API_LIMITS.MAX_OFFSET` - debería estar en lugar de `10000`
3. Busca `ML_API_LIMITS.MAX_ITEMS_PER_PAGE` - debería estar en lugar de `50`

### 4. Verificar que no se rompió funcionalidad existente

#### Endpoints a probar:

1. **GET** `/api/global-sellers/:id/items` - Listar items
2. **GET** `/api/global-sellers/:id/items/count` - Contar items
3. **POST** `/api/global-sellers/:id/items/sync` - Sincronizar items
4. **POST** `/api/global-sellers/:id/items/load` - Cargar items página por página
5. **GET** `/api/global-sellers/:id/items/saved` - Obtener items guardados

### 5. Verificar logs estructurados

En los logs deberías ver formato como:
```
[2024-01-08T21:30:00.000Z] [DEBUG] Searching items: ...
[2024-01-08T21:30:00.100Z] [ERROR] Error searching items: ...
```

### 6. Checklist de pruebas

- [ ] El servidor inicia sin errores
- [ ] TypeScript compila sin errores
- [ ] Los endpoints responden correctamente
- [ ] Las validaciones funcionan (rechazan valores inválidos)
- [ ] Los logs usan el nuevo sistema (no hay console.log directos)
- [ ] Las constantes están centralizadas (no hay números mágicos)
- [ ] No hay errores en la consola del navegador
- [ ] La funcionalidad existente sigue funcionando

## Si encuentras problemas

1. Revisa los logs de wrangler para ver errores
2. Verifica que la base de datos local esté corriendo: `npm run db:migrate:local`
3. Revisa la consola del navegador para errores de JavaScript
4. Ejecuta `npm run typecheck` para ver errores de TypeScript

## Después de probar

Si todo funciona correctamente:

1. **Hacer commit de los cambios:**
   ```bash
   git add .
   git commit -m "refactor: Aplicar mejoras del PR review - logging, validaciones y type safety"
   ```

2. **Push a la rama del PR:**
   ```bash
   git push origin integracion-con-meli
   ```

3. **Mergear a main** (después de revisar el PR en GitHub):
   ```bash
   git checkout main
   git merge integracion-con-meli
   git push origin main
   ```

