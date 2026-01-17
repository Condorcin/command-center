# Guía Completa: Sincronización de CBTs (Cross Border Trade)

## 📋 Resumen del Sistema

Este sistema sincroniza todos los items de Mercado Libre que comienzan con "CBT" (Cross Border Trade) desde la API de ML hacia la base de datos local. Está diseñado para manejar grandes volúmenes (396,831+ items) de forma robusta y continua.

---

## 🔄 Flujo Completo del Proceso

### 1. **Inicio de la Sincronización (Frontend)**

**Ubicación:** `src/routes/global-seller-details.ts` - función `fetchCBTs()`

**Qué hace:**
- Usuario hace clic en "Buscar CBTs"
- Frontend envía `POST /api/global-sellers/:id/cbts/sync` (sin límite de `maxItems`)
- Inicia el polling cada 2 segundos para mostrar progreso

**Código clave:**
```javascript
const syncUrl = `/api/global-sellers/${globalSellerId}/cbts/sync`;
// No pasa maxItems, así que sincroniza TODOS los CBTs
```

---

### 2. **Procesamiento Inicial (Backend - Síncrono)**

**Ubicación:** `src/routes/global-seller-items.ts` - función `syncCBTsHandler()`

**Qué hace:**
- Procesa las **primeras 5 páginas (500 CBTs)** de forma síncrona
- Esto asegura que el proceso comience antes de retornar la respuesta
- Guarda cada página en la base de datos usando `bulkUpsert`

**Proceso:**
1. Obtiene `scroll_id` inicial de Mercado Libre (modo scan)
2. Filtra items que comienzan con "CBT"
3. Guarda en BD con `ON CONFLICT DO UPDATE` (no duplica)
4. Actualiza `scroll_id` con cada respuesta
5. Repite hasta 5 páginas

**Código clave:**
```typescript
const SYNC_PAGES_BEFORE_RESPONSE = 5; // Procesa 5 páginas antes de retornar
while (hasMore && pageCount < SYNC_PAGES_BEFORE_RESPONSE) {
  // ... procesa página ...
}
```

---

### 3. **Procesamiento en Background (Backend - Asíncrono)**

**Ubicación:** `src/routes/global-seller-items.ts` - función `syncCBTsHandler()` - proceso en background

**Qué hace:**
- Continúa procesando páginas indefinidamente hasta:
  - Llegar al final de los resultados de ML
  - O encontrar un error (token expirado, etc.)

**Características importantes:**
- Usa `ctx.waitUntil()` para continuar después de retornar la respuesta
- El proceso continúa **incluso si cierras el navegador**
- Procesa 100 CBTs por página
- Delay de 500ms entre páginas para no sobrecargar la API

**Código clave:**
```typescript
const backgroundSyncPromise = (async () => {
  while (hasMore) {
    // ... procesa página ...
    await new Promise(resolve => setTimeout(resolve, 500)); // Delay entre páginas
  }
})();
ctx.waitUntil(backgroundSyncPromise); // Continúa en background
```

---

### 4. **Manejo del Scroll ID**

**¿Qué es el Scroll ID?**
- Token temporal de Mercado Libre para paginación en modo "scan"
- **Expira después de 5 minutos**
- Se actualiza con cada respuesta de la API

**Cómo funciona:**
1. Primera página: No se envía `scroll_id` → ML devuelve uno nuevo
2. Páginas siguientes: Se envía el `scroll_id` anterior → ML devuelve uno nuevo
3. Se actualiza el `scroll_id` con cada respuesta (igual que el frontend que funcionó)

**Manejo de expiración:**
- Si el `scroll_id` expira (>5 minutos), se obtiene uno nuevo automáticamente
- Si no hay `scroll_id` en la respuesta, significa que se llegó al final

**Código clave:**
```typescript
// Verifica expiración
if (scrollId && scrollIdStartTime) {
  const elapsed = Date.now() - scrollIdStartTime;
  if (elapsed >= 5 * 60 * 1000) { // 5 minutos
    scrollId = null; // Obtiene uno nuevo
  }
}

// Actualiza scroll_id con cada respuesta
scrollId = searchResult.scroll_id || null;
```

---

### 5. **Guardado en Base de Datos**

**Método:** `ItemRepository.bulkUpsert()`

**Características:**
- Usa `ON CONFLICT(global_seller_id, ml_item_id) DO UPDATE SET`
- **No duplica items** - si ya existe, lo actualiza
- Permite reanudar la sincronización sin problemas

**Código SQL:**
```sql
INSERT INTO items (...) 
VALUES (...)
ON CONFLICT(global_seller_id, ml_item_id) 
DO UPDATE SET synced_at = excluded.synced_at, ...
```

**Ventaja:** Si el proceso se detiene y se reinicia, continúa desde donde se quedó sin duplicar.

---

### 6. **Monitoreo del Progreso (Frontend)**

**Ubicación:** `src/routes/global-seller-details.ts` - función `startProgressPolling()`

**Qué hace:**
- Consulta cada 2 segundos: `GET /api/global-sellers/:id/cbts/saved`
- Muestra progreso: "X de 396,831 CBTs guardados"
- Calcula porcentaje basado en el total de ML

**Detección de problemas:**
- Si no hay progreso por **20 segundos** (10 polls) y aún faltan CBTs:
  - Muestra advertencia de posible token expirado
  - Instruye al usuario a actualizar el token

**Código clave:**
```javascript
if (total === lastTotal) {
  noProgressCount++;
  if (noProgressCount >= 10 && progressPercent < 99) {
    // Muestra advertencia de token expirado
  }
}
```

---

## 🔑 Manejo de Token Expirado

### Detección en Backend

**Ubicación:** `src/routes/global-seller-items.ts` - catch del proceso en background

**Qué detecta:**
- Errores 401 (Unauthorized)
- Mensajes que contienen "expired", "invalid access token", "Unauthorized"

**Qué hace:**
- Detiene el proceso inmediatamente
- Guarda el estado de sincronización (página, total guardado, scroll_id)
- Lanza error especial: `TOKEN_EXPIRED:SYNC_PAUSED:...`

**Código clave:**
```typescript
const isTokenError = errorMsg.includes('401') || 
                     errorMsg.includes('Unauthorized') || 
                     errorMsg.includes('invalid access token');

if (isTokenError) {
  // Guarda estado y detiene proceso
  throw new Error('TOKEN_EXPIRED:SYNC_PAUSED:' + JSON.stringify(syncState));
}
```

---

### Detección en Frontend

**Qué detecta:**
- No hay progreso por 20 segundos
- Aún faltan CBTs por sincronizar (< 99% del total)

**Qué muestra:**
- Mensaje de advertencia con instrucciones
- Indica cuántos CBTs se guardaron hasta ahora
- Indica cuántos faltan por sincronizar

**Instrucciones al usuario:**
1. Actualizar el token de Mercado Libre en la configuración del Global Seller
2. Hacer clic en "Buscar CBTs" nuevamente para reanudar

---

### Reanudación

**Cómo funciona:**
1. Usuario actualiza el token en la configuración del Global Seller
2. Usuario hace clic en "Buscar CBTs" nuevamente
3. El proceso comienza desde el principio, pero:
   - Los CBTs ya guardados se actualizan (no se duplican)
   - Solo se agregan los CBTs faltantes
   - Continúa hasta completar todos

**Ventaja:** No necesita guardar estado - la BD ya tiene los CBTs guardados.

---

## 📊 Verificación del Progreso

### En el Frontend

**Indicadores visibles:**
- **CBTs encontrados:** Total guardado en BD
- **Faltan por traer:** Total de ML - Total guardado
- **Barra de progreso:** Porcentaje completado
- **Tabla:** Muestra los CBTs guardados con numeración

**Actualización:** Cada 2 segundos automáticamente

---

### En los Logs del Backend

**Logs importantes:**
- `[SYNC CBTS] ✅ Saved X CBTs (total saved in this sync: Y)`
- `[SYNC CBTS] 📊 Actual CBTs in database now: Z`
- `[SYNC CBTS] 🔍 Fetching page X...`
- `[SYNC CBTS] 🔄 Updated scroll_id: ...`

**Buscar en terminal:**
```bash
# Ver progreso
grep "SYNC CBTS.*Saved" logs.txt

# Ver errores
grep "SYNC CBTS.*Error" logs.txt

# Ver token expirado
grep "TOKEN EXPIRED" logs.txt
```

---

## ⚠️ Casos Especiales y Soluciones

### 1. Token Expira Durante la Sincronización

**Síntomas:**
- El progreso se detiene
- Frontend muestra advertencia después de 20 segundos sin progreso

**Solución:**
1. Ir a configuración del Global Seller
2. Actualizar el token de Mercado Libre
3. Hacer clic en "Buscar CBTs" nuevamente
4. El proceso continúa desde donde se quedó

---

### 2. Scroll ID Expira

**Síntomas:**
- Normalmente no hay síntomas - se maneja automáticamente

**Solución:**
- El sistema detecta automáticamente cuando el scroll_id expira (>5 minutos)
- Obtiene uno nuevo automáticamente en la siguiente llamada
- No requiere intervención del usuario

---

### 3. Proceso se Detiene por Error

**Síntomas:**
- No hay progreso por más de 20 segundos
- Frontend muestra advertencia

**Solución:**
1. Revisar logs del backend para identificar el error
2. Si es token expirado: actualizar token y reanudar
3. Si es otro error: revisar logs y corregir
4. Hacer clic en "Buscar CBTs" para reanudar

---

### 4. Navegador se Cierra

**Comportamiento:**
- **En desarrollo local:** El proceso continúa en el servidor local (usa `ctx.waitUntil()`)
- **En producción:** El proceso continúa en Cloudflare Workers
- El frontend deja de mostrar progreso
- Al volver a abrir la página, se muestra el progreso actual

**Verificación:**
- Abrir la página del Global Seller
- Ver el contador de "CBTs encontrados"
- Si sigue aumentando, el proceso está corriendo

---

### 5. **PC se Suspende (Solo Desarrollo Local)**

**Comportamiento:**
- ❌ **El proceso se detiene** - Miniflare corre localmente en tu máquina
- ✅ **Los CBTs ya guardados están seguros** - Se guardaron después de cada página
- ✅ **No se pierde progreso** - Los CBTs guardados permanecen en la BD

**Solución:**
1. **Reanudar la PC**
2. **Reiniciar el servidor** (`npm run dev`)
3. **Hacer clic en "Buscar CBTs"** nuevamente
4. **El proceso continúa desde donde se quedó** - Solo agrega los CBTs faltantes

**Nota:** En producción (Cloudflare Workers), suspender tu PC NO afecta el proceso porque corre en la nube.

---

## 🎯 Características Clave

### 1. **Sin Límite de Items**
- Sincroniza todos los CBTs disponibles (396,831+)
- No hay límite artificial

### 2. **Proceso Continuo**
- Continúa en background incluso si cierras el navegador
- Usa `ctx.waitUntil()` para garantizar continuidad

### 3. **Sin Duplicados**
- Usa `ON CONFLICT DO UPDATE` en la BD
- Permite reanudar sin problemas

### 4. **Manejo Robusto de Errores**
- Detecta token expirado
- Maneja expiración de scroll_id
- Reintentos automáticos para errores temporales

### 5. **Monitoreo en Tiempo Real**
- Actualización cada 2 segundos en el frontend
- Logs detallados en el backend

---

## ⚠️ IMPORTANTE: Desarrollo Local vs Producción

### 🔴 Desarrollo Local (Miniflare)

**Si suspendes la PC:**
- ❌ **El proceso se detendrá** - Miniflare corre localmente en tu máquina
- ✅ **Los CBTs ya guardados están seguros** - Se guardaron en la BD antes de detenerse
- ✅ **Puedes reanudar fácilmente** - Solo haz clic en "Buscar CBTs" nuevamente

**Recomendaciones para desarrollo local:**
- ⚠️ **NO suspender la PC** durante la sincronización
- ⚠️ **Mantener el servidor corriendo** (`npm run dev`)
- ✅ **Los CBTs se guardan después de cada página** - No perderás progreso si se detiene
- ✅ **Puedes cerrar el navegador** - El proceso continúa en el servidor local

### 🟢 Producción (Cloudflare Workers)

**Si suspendes tu PC:**
- ✅ **El proceso continúa** - Cloudflare Workers corre en la nube
- ✅ **No se afecta** - Tu PC solo es el cliente
- ✅ **Puedes cerrar todo** - El proceso sigue en Cloudflare

**Ventajas de producción:**
- ✅ Proceso corre en la nube (no depende de tu PC)
- ✅ Puedes cerrar navegador, suspender PC, etc.
- ✅ Alta disponibilidad y escalabilidad

---

## 📝 Checklist para Dejar Corriendo

### En Desarrollo Local:

Antes de dejar el proceso corriendo:

- [ ] **Token de Mercado Libre está actualizado y válido**
- [ ] **Servidor está corriendo** (`npm run dev`)
- [ ] **NO suspender la PC** durante la sincronización
- [ ] **Navegador muestra el progreso** (opcional, pero recomendado)
- [ ] **Logs del backend están visibles** (para monitoreo)

Durante la ejecución:

- [ ] **Mantener la PC activa** (no suspender)
- [ ] **Verificar progreso periódicamente** (cada hora o según necesidad)
- [ ] **Revisar logs si hay advertencias**
- [ ] **Si el progreso se detiene:** verificar token y reanudar

Después de completar:

- [ ] **Verificar total guardado** en el frontend
- [ ] **Comparar con total de ML** (debería ser ~99-100%)
- [ ] **Revisar tabla de CBTs** para verificar que se guardaron correctamente

### En Producción:

- [ ] **Token de Mercado Libre está actualizado y válido**
- [ ] **Puedes cerrar todo** - El proceso corre en Cloudflare
- [ ] **Puedes suspender tu PC** - No afecta el proceso
- [ ] **Verificar progreso cuando vuelvas** - Abre la página y revisa el contador

---

## 🔍 Comandos Útiles

### Ver progreso en tiempo real
```bash
# En la terminal donde corre el servidor
# Buscar logs de progreso
tail -f logs.txt | grep "SYNC CBTS.*Saved"
```

### Verificar total en BD
```bash
# Consultar directamente la BD (si tienes acceso)
SELECT COUNT(*) FROM items WHERE ml_item_id LIKE 'CBT%';
```

### Ver errores
```bash
# Buscar errores en logs
grep "ERROR\|Error\|❌" logs.txt
```

---

## 📈 Estimación de Tiempo

**Cálculo aproximado:**
- **Total de CBTs:** 396,831
- **CBTs por página:** 100
- **Páginas totales:** ~3,969
- **Delay entre páginas:** 500ms
- **Tiempo por página:** ~1-2 segundos (API + delay)
- **Tiempo total estimado:** ~1-2 horas

**Factores que afectan:**
- Velocidad de la API de Mercado Libre
- Tasa de errores y reintentos
- Si el token expira (requiere reanudación)

---

## ✅ Resumen Final

**El sistema está diseñado para:**
1. ✅ Sincronizar todos los CBTs automáticamente
2. ✅ Continuar en background sin necesidad del navegador
3. ✅ Manejar errores (token expirado, scroll_id, etc.)
4. ✅ Permitir reanudación sin duplicar datos
5. ✅ Mostrar progreso en tiempo real

**Puedes dejarlo corriendo con confianza** - el sistema manejará automáticamente la mayoría de los problemas. Solo necesitas intervenir si:
- El token expira (actualizar y reanudar)
- Hay un error crítico (revisar logs y corregir)

---

**Última actualización:** 2026-01-16
**Versión del sistema:** Sin límite de items, con manejo de token expirado
