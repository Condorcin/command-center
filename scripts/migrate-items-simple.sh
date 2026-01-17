#!/bin/bash

# Script simplificado para migrar items de desarrollo a producción
# Usa wrangler d1 export/execute directamente

DB_NAME="orbix-db"
TEMP_EXPORT="temp-local-export.sql"

echo "🔄 Migración de Items a Producción"
echo "==================================="
echo ""

# Paso 1: Exportar base de datos local
echo "📦 Paso 1: Exportando base de datos local..."
wrangler d1 export $DB_NAME --local --output $TEMP_EXPORT

if [ $? -ne 0 ]; then
  echo "❌ Error al exportar base de datos local"
  exit 1
fi

echo "✅ Exportación completada"
echo ""

# Paso 2: Contar items en desarrollo
echo "📊 Paso 2: Contando items en desarrollo..."
LOCAL_COUNT=$(wrangler d1 execute $DB_NAME --local --command "SELECT COUNT(*) as count FROM items;" --json 2>/dev/null | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)

if [ -z "$LOCAL_COUNT" ]; then
  LOCAL_COUNT=0
fi

echo "📦 Items en desarrollo: $LOCAL_COUNT"
echo ""

if [ "$LOCAL_COUNT" -eq 0 ]; then
  echo "✅ No hay items para migrar"
  rm -f $TEMP_EXPORT
  exit 0
fi

# Paso 3: Contar items en producción
echo "📊 Paso 3: Contando items en producción..."
PROD_COUNT=$(wrangler d1 execute $DB_NAME --command "SELECT COUNT(*) as count FROM items;" --json 2>/dev/null | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)

if [ -z "$PROD_COUNT" ]; then
  PROD_COUNT=0
fi

echo "📦 Items en producción: $PROD_COUNT"
echo ""

# Paso 4: Confirmar migración
echo "⚠️  ADVERTENCIA: Esto migrará datos a PRODUCCIÓN"
echo "📊 Items a migrar: $LOCAL_COUNT"
echo ""
read -p "¿Continuar con la migración? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Migración cancelada"
  rm -f $TEMP_EXPORT
  exit 1
fi

# Paso 5: Extraer solo la tabla items del export
echo ""
echo "📝 Paso 4: Preparando datos para migración..."

# Crear archivo SQL solo con INSERTs de items
ITEMS_SQL="temp-items-migration.sql"

# Extraer sección de items del dump
awk '/CREATE TABLE.*items/,/^[^I]/ { if (/^INSERT/) print }' $TEMP_EXPORT > $ITEMS_SQL 2>/dev/null

# Si no hay INSERTs directos, usar método alternativo
if [ ! -s "$ITEMS_SQL" ]; then
  echo "⚠️  No se encontraron INSERTs directos, usando método alternativo..."
  
  # Obtener items y generar SQL manualmente
  wrangler d1 execute $DB_NAME --local --command "
    SELECT 
      'INSERT OR REPLACE INTO items (id, global_seller_id, ml_item_id, site_id, title, price, currency_id, available_quantity, sold_quantity, status, listing_type_id, condition, permalink, thumbnail, category_id, start_time, stop_time, end_time, created_at, updated_at, synced_at, metadata) VALUES (''' ||
      id || ''', ''' ||
      global_seller_id || ''', ''' ||
      ml_item_id || ''', ' ||
      COALESCE('''' || site_id || '''', 'NULL') || ', ' ||
      COALESCE('''' || REPLACE(COALESCE(title, ''), '''', '''''') || '''', 'NULL') || ', ' ||
      COALESCE(price, 'NULL') || ', ' ||
      COALESCE('''' || currency_id || '''', 'NULL') || ', ' ||
      available_quantity || ', ' ||
      sold_quantity || ', ' ||
      '''' || status || ''', ' ||
      COALESCE('''' || listing_type_id || '''', 'NULL') || ', ' ||
      COALESCE('''' || condition || '''', 'NULL') || ', ' ||
      COALESCE('''' || permalink || '''', 'NULL') || ', ' ||
      COALESCE('''' || thumbnail || '''', 'NULL') || ', ' ||
      COALESCE('''' || category_id || '''', 'NULL') || ', ' ||
      COALESCE(start_time, 'NULL') || ', ' ||
      COALESCE(stop_time, 'NULL') || ', ' ||
      COALESCE(end_time, 'NULL') || ', ' ||
      created_at || ', ' ||
      updated_at || ', ' ||
      COALESCE(synced_at, 'NULL') || ', ' ||
      COALESCE('''' || REPLACE(COALESCE(metadata, ''), '''', '''''') || '''', 'NULL') ||
      ');'
    FROM items;
  " --output $ITEMS_SQL 2>/dev/null || {
    echo "❌ Error al generar SQL de items"
    rm -f $TEMP_EXPORT $ITEMS_SQL
    exit 1
  }
fi

ITEMS_SQL_LINES=$(wc -l < $ITEMS_SQL 2>/dev/null || echo "0")
echo "📄 Líneas SQL generadas: $ITEMS_SQL_LINES"
echo ""

if [ "$ITEMS_SQL_LINES" -eq 0 ]; then
  echo "⚠️  No se generaron datos para migrar"
  rm -f $TEMP_EXPORT $ITEMS_SQL
  exit 0
fi

# Paso 6: Importar a producción
echo "📤 Paso 5: Importando a producción..."
echo "⏳ Esto puede tardar varios minutos con muchos items..."
echo ""

wrangler d1 execute $DB_NAME --file $ITEMS_SQL

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Migración completada exitosamente"
  echo "📊 Items procesados: ~$ITEMS_SQL_LINES"
  
  # Verificar conteo final
  NEW_PROD_COUNT=$(wrangler d1 execute $DB_NAME --command "SELECT COUNT(*) as count FROM items;" --json 2>/dev/null | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)
  echo "📊 Items en producción después de migración: ${NEW_PROD_COUNT:-$PROD_COUNT}"
  
  # Obtener timestamp actual
  CURRENT_TIMESTAMP=$(date +%s)
  echo ""
  echo "💾 Timestamp actual: $CURRENT_TIMESTAMP"
  echo "💡 Para próxima migración incremental, guarda este timestamp"
else
  echo ""
  echo "❌ Error al importar a producción"
  echo "💡 Verifica los logs arriba para más detalles"
  rm -f $TEMP_EXPORT $ITEMS_SQL
  exit 1
fi

# Limpiar archivos temporales
rm -f $TEMP_EXPORT $ITEMS_SQL
echo ""
echo "🧹 Archivos temporales eliminados"
