#!/bin/bash

# Script para migrar items (CBTs) de desarrollo a producción
# Este script exporta solo los items de la base de datos local
# y los importa a producción de forma incremental (usando INSERT OR IGNORE)

DB_NAME="orbix-db"
TEMP_FILE="temp-items-export.sql"

echo "🔄 Migrando items de desarrollo a producción..."
echo "⚠️  Esto migrará datos a PRODUCCIÓN"

read -p "¿Continuar? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Migración cancelada"
  exit 1
fi

# Paso 1: Exportar solo la tabla items de desarrollo
echo "📦 Paso 1: Exportando items de desarrollo..."
wrangler d1 execute $DB_NAME --local --command "
  SELECT 'INSERT OR IGNORE INTO items (
    id, global_seller_id, ml_item_id, site_id, title, price, currency_id,
    available_quantity, sold_quantity, status, listing_type_id, condition,
    permalink, thumbnail, category_id, start_time, stop_time, end_time,
    created_at, updated_at, synced_at, metadata
  ) VALUES (''' || 
    id || ''', ''' || 
    global_seller_id || ''', ''' || 
    ml_item_id || ''', ' ||
    COALESCE('''' || site_id || '''', 'NULL') || ', ' ||
    COALESCE('''' || REPLACE(title, '''', '''''') || '''', 'NULL') || ', ' ||
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
    COALESCE('''' || REPLACE(metadata, '''', '''''') || '''', 'NULL') ||
    ');'
  FROM items;
" --output $TEMP_FILE

if [ $? -ne 0 ]; then
  echo "❌ Error al exportar items"
  exit 1
fi

# Paso 2: Contar items a migrar
ITEM_COUNT=$(wrangler d1 execute $DB_NAME --local --command "SELECT COUNT(*) as count FROM items;" --json | jq -r '.[0].results[0].count')
echo "📊 Items a migrar: $ITEM_COUNT"

if [ "$ITEM_COUNT" -eq 0 ]; then
  echo "⚠️  No hay items para migrar"
  rm -f $TEMP_FILE
  exit 0
fi

# Paso 3: Importar a producción
echo "📤 Paso 2: Importando items a producción..."
echo "⚠️  Esto puede tardar varios minutos si hay muchos items..."

# Leer el archivo SQL y ejecutarlo en producción
if [ -f "$TEMP_FILE" ]; then
  wrangler d1 execute $DB_NAME --file $TEMP_FILE
  
  if [ $? -eq 0 ]; then
    echo "✅ Migración completada exitosamente"
    echo "📊 Items migrados: $ITEM_COUNT"
  else
    echo "❌ Error al importar items a producción"
    rm -f $TEMP_FILE
    exit 1
  fi
  
  # Limpiar archivo temporal
  rm -f $TEMP_FILE
else
  echo "❌ No se encontró el archivo de exportación"
  exit 1
fi
