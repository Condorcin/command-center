# Guía de Migración de Base de Datos a Producción

Esta guía explica cómo migrar los datos de desarrollo a producción de forma segura e incremental.

## 🚀 Método Rápido (Recomendado)

### Migración Completa de Items (Primera vez)
```bash
npm run db:migrate:data
```

Este script:
1. Exporta la base de datos local
2. Extrae solo los items (CBTs)
3. Los importa a producción usando `INSERT OR REPLACE` (evita duplicados)
4. Muestra el progreso y estadísticas

### Migración Incremental (Solo datos nuevos)
```bash
npm run db:migrate:data:incremental --timestamp=1705449600
```

El script te mostrará el timestamp para la próxima migración incremental.

## 📋 Requisitos Previos

1. Tener acceso a Cloudflare Dashboard
2. Tener `wrangler` CLI instalado y configurado
3. Tener credenciales de Cloudflare configuradas

## 🗄️ Estructura de Base de Datos

La base de datos contiene las siguientes tablas principales:
- `users` - Usuarios del sistema
- `sessions` - Sesiones activas
- `global_sellers` - Vendedores globales
- `items` - Items/CBTs sincronizados de Mercado Libre
- `marketplace_items` - Items de marketplace

## 📦 Opciones de Migración

### Opción 1: Migración Completa (Primera vez)

Para migrar toda la base de datos de desarrollo a producción:

```bash
# 1. Exportar base de datos local completa
./scripts/export-db.sh db-backup-local.sql

# 2. Verificar el archivo exportado
head -20 db-backup-local.sql

# 3. Importar a producción (CUIDADO: esto sobrescribirá datos existentes)
wrangler d1 execute orbix-db --file db-backup-local.sql
```

### Opción 2: Migración Incremental (Recomendado)

Para migrar solo los datos nuevos o actualizados:

```bash
# Primera migración (migra todos los items)
./scripts/migrate-incremental.sh

# Migraciones subsecuentes (solo items nuevos/actualizados)
# Usa el timestamp que se muestra al final de la migración anterior
./scripts/migrate-incremental.sh 1705449600
```

### Opción 3: Migración Solo de Items (CBTs)

Para migrar solo la tabla de items:

```bash
./scripts/migrate-items-to-prod.sh
```

## 🔄 Proceso Recomendado para Migración Incremental

### Paso 1: Verificar Estado Actual

```bash
# Contar items en desarrollo
wrangler d1 execute orbix-db --local --command "SELECT COUNT(*) as count FROM items;"

# Contar items en producción
wrangler d1 execute orbix-db --command "SELECT COUNT(*) as count FROM items;"
```

### Paso 2: Exportar Backup de Producción (Seguridad)

```bash
# Crear backup de producción antes de migrar
./scripts/export-db-prod.sh db-backup-prod-$(date +%Y%m%d).sql
```

### Paso 3: Ejecutar Migración Incremental

```bash
# Migrar items nuevos/actualizados
./scripts/migrate-incremental.sh [timestamp_ultima_migracion]
```

### Paso 4: Verificar Migración

```bash
# Verificar conteo en producción
wrangler d1 execute orbix-db --command "SELECT COUNT(*) as count FROM items;"

# Verificar algunos items específicos
wrangler d1 execute orbix-db --command "SELECT ml_item_id, title, synced_at FROM items ORDER BY synced_at DESC LIMIT 10;"
```

## 📊 Scripts Disponibles

### `scripts/export-db.sh`
Exporta la base de datos local completa a un archivo SQL.

**Uso:**
```bash
./scripts/export-db.sh [nombre_archivo.sql]
```

### `scripts/export-db-prod.sh`
Exporta la base de datos de producción a un archivo SQL (requiere confirmación).

**Uso:**
```bash
./scripts/export-db-prod.sh [nombre_archivo.sql]
```

### `scripts/migrate-items-to-prod.sh`
Migra solo la tabla `items` de desarrollo a producción usando `INSERT OR IGNORE`.

**Uso:**
```bash
./scripts/migrate-items-to-prod.sh
```

### `scripts/migrate-incremental.sh`
Migra solo los items nuevos o actualizados desde un timestamp específico.

**Uso:**
```bash
# Primera vez (migra todos)
./scripts/migrate-incremental.sh

# Migración incremental (solo nuevos)
./scripts/migrate-incremental.sh 1705449600
```

## ⚠️ Consideraciones Importantes

### 1. **Deduplicación**
- Los scripts usan `INSERT OR IGNORE` o `INSERT OR REPLACE` para evitar duplicados
- La tabla `items` tiene un índice único en `(global_seller_id, ml_item_id)`

### 2. **Datos Sensibles**
- **NO migrar** la tabla `sessions` (son temporales)
- **NO migrar** la tabla `users` sin verificar (pueden tener passwords diferentes)
- **SÍ migrar** `items` y `global_sellers` (datos de negocio)

### 3. **Tamaño de Datos**
- Con ~396k items, la migración puede tardar varios minutos
- Los scripts procesan en lotes para evitar timeouts

### 4. **Backups**
- **SIEMPRE** crear un backup de producción antes de migrar
- Guardar los backups en un lugar seguro

## 🔍 Verificación Post-Migración

Después de migrar, verifica:

```bash
# 1. Conteo de items
wrangler d1 execute orbix-db --command "SELECT COUNT(*) FROM items;"

# 2. Items sincronizados vs no sincronizados
wrangler d1 execute orbix-db --command "
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN title IS NOT NULL OR price IS NOT NULL THEN 1 ELSE 0 END) as synced,
    SUM(CASE WHEN title IS NULL AND price IS NULL THEN 1 ELSE 0 END) as not_synced
  FROM items;
"

# 3. Items por global_seller
wrangler d1 execute orbix-db --command "
  SELECT 
    gs.name,
    COUNT(i.id) as item_count
  FROM global_sellers gs
  LEFT JOIN items i ON i.global_seller_id = gs.id
  GROUP BY gs.id, gs.name;
"
```

## 🚀 Flujo de Trabajo Recomendado

1. **Desarrollo Local**: Sincronizar CBTs y trabajar con datos locales
2. **Backup Producción**: Antes de migrar, crear backup de producción
3. **Migración Incremental**: Migrar solo datos nuevos/actualizados
4. **Verificación**: Verificar que los datos se migraron correctamente
5. **Deploy Código**: Desplegar el código actualizado a producción

## 📝 Notas Adicionales

- Los timestamps en SQLite/D1 son en formato Unix (segundos desde epoch)
- Para obtener el timestamp actual: `date +%s`
- Para convertir timestamp a fecha: `date -r 1705449600`

## 🆘 Troubleshooting

### Error: "Database not found"
- Verifica que el `database_id` en `wrangler.toml` sea correcto
- Verifica que tengas permisos en Cloudflare

### Error: "Timeout"
- Los scripts procesan en lotes, pero con muchos datos puede tardar
- Considera migrar en horarios de menor uso

### Error: "Duplicate key"
- Normal si usas `INSERT OR IGNORE` o `INSERT OR REPLACE`
- Verifica que el índice único esté correcto
