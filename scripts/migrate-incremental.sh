#!/bin/bash

# Script para migración incremental de datos de desarrollo a producción
# Migra solo los items nuevos o actualizados desde la última migración
# Uso: ./scripts/migrate-incremental.sh [last_synced_timestamp]

DB_NAME="orbix-db"
LAST_SYNC=${1:-0}  # Por defecto, migrar todos si no se especifica

echo "🔄 Migración incremental de items a producción..."
echo "📅 Última sincronización: ${LAST_SYNC:-'Ninguna (migrar todos)'}"
echo "⚠️  Esto migrará datos a PRODUCCIÓN"

read -p "¿Continuar? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Migración cancelada"
  exit 1
fi

# Contar items a migrar
if [ "$LAST_SYNC" -eq 0 ]; then
  ITEM_COUNT=$(wrangler d1 execute $DB_NAME --local --command "SELECT COUNT(*) as count FROM items;" --json | jq -r '.[0].results[0].count')
  echo "📊 Total de items a migrar: $ITEM_COUNT"
else
  ITEM_COUNT=$(wrangler d1 execute $DB_NAME --local --command "SELECT COUNT(*) as count FROM items WHERE updated_at > $LAST_SYNC OR synced_at > $LAST_SYNC;" --json | jq -r '.[0].results[0].count')
  echo "📊 Items nuevos/actualizados a migrar: $ITEM_COUNT"
fi

if [ "$ITEM_COUNT" -eq 0 ]; then
  echo "✅ No hay items nuevos para migrar"
  exit 0
fi

# Crear archivo SQL temporal con INSERT OR REPLACE
TEMP_FILE="temp-incremental-export.sql"

echo "📦 Generando SQL de migración..."

# Generar SQL usando wrangler d1 execute con output
if [ "$LAST_SYNC" -eq 0 ]; then
  # Migrar todos los items
  wrangler d1 execute $DB_NAME --local --command "
    SELECT 'INSERT OR REPLACE INTO items (
      id, global_seller_id, ml_item_id, site_id, title, price, currency_id,
      available_quantity, sold_quantity, status, listing_type_id, condition,
      permalink, thumbnail, category_id, start_time, stop_time, end_time,
      created_at, updated_at, synced_at, metadata
    ) VALUES (''' || 
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
  " > $TEMP_FILE
else
  # Migrar solo items nuevos/actualizados
  wrangler d1 execute $DB_NAME --local --command "
    SELECT 'INSERT OR REPLACE INTO items (
      id, global_seller_id, ml_item_id, site_id, title, price, currency_id,
      available_quantity, sold_quantity, status, listing_type_id, condition,
      permalink, thumbnail, category_id, start_time, stop_time, end_time,
      created_at, updated_at, synced_at, metadata
    ) VALUES (''' || 
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
    FROM items
    WHERE updated_at > $LAST_SYNC OR synced_at > $LAST_SYNC;
  " > $TEMP_FILE
fi

if [ ! -s "$TEMP_FILE" ]; then
  echo "⚠️  No se generaron datos para migrar"
  rm -f $TEMP_FILE
  exit 0
fi

# Importar a producción
echo "📤 Importando a producción..."
wrangler d1 execute $DB_NAME --file $TEMP_FILE

if [ $? -eq 0 ]; then
  echo "✅ Migración completada exitosamente"
  echo "📊 Items migrados: $ITEM_COUNT"
  
  # Obtener timestamp actual para próxima migración
  CURRENT_TIMESTAMP=$(date +%s)
  echo "💾 Timestamp para próxima migración: $CURRENT_TIMESTAMP"
  echo "💡 Usa este comando para la próxima migración incremental:"
  echo "   ./scripts/migrate-incremental.sh $CURRENT_TIMESTAMP"
else
  echo "❌ Error al importar items a producción"
  rm -f $TEMP_FILE
  exit 1
fi

# Limpiar archivo temporal
rm -f $TEMP_FILE
